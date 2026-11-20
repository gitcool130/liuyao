/* ============================================================
 * 莲斋六爻排盘 · Windows 便携版外壳
 *
 * 设计要点（每一条都是踩过的坑）：
 *  1. 不启 HTTP 服务：用 WebView2 的 SetVirtualHostNameToFolderMapping 把解压出的
 *     public/ 映射成 https://liuyao.local/。origin 是 https → localStorage、
 *     crypto、clipboard 都按安全上下文处理；页面里的 fetch('/api/...') 由
 *     core/local-api.js 在 JS 层接管，真正的上游请求直连服务商（已实测
 *     DeepSeek / Gemini 都回 Access-Control-Allow-Origin）。
 *     若改用 HttpListener，127.0.0.1 也要 urlacl，非管理员直接 Access denied。
 *  2. 真单文件：payload.zip + 两个托管 dll + WebView2Loader.dll 全部以资源内嵌，
 *     运行时解到 %LOCALAPPDATA%。托管 dll 走 AssemblyResolve，原生 loader 先
 *     LoadLibrary 预加载（同名模块已在进程内，Core.dll 的 DllImport 会复用它）。
 *  3. 解压按 exe 修改时间打标：换了新 exe 自动重铺页面，用户不用手动清缓存。
 * ============================================================ */
using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
/* WinRT 投影：编译期需引用 System.Runtime.WindowsRuntime.dll 与 WinMetadata\*.winmd，
 * 见 Program.cs 顶部 OcrImageAsync 的注释（反射拿不到 WinRT 成员，只能走强类型）。 */
/* 不引 Windows.Foundation 整个命名空间：它里面的 Size 会与 System.Drawing.Size
 * 撞成 CS0104（WebView2 那边也用 Size）。下面统一写全名。 */
using Windows.Globalization;
using Windows.Graphics.Imaging;
using Windows.Media.Ocr;
using Windows.Storage.Streams;
using Microsoft.Web.WebView2.WinForms;

static class Shell
{
    const string AppTitle = "莲斋 · 六爻排盘";
    const string Host = "liuyao.local";
    static readonly string Root = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "LianZhaiLiuYao");
    static readonly string WebDir = Path.Combine(Root, "web");
    static readonly string BinDir = Path.Combine(Root, "bin");
    static readonly string ProfileDir = Path.Combine(Root, "profile");

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr LoadLibraryW(string path);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool SetDllDirectoryW(string path);

    [STAThread]
    static void Main()
    {
        /* 关键：Main 里**不能**出现任何 WebView2 类型。
         * CLR 在进入方法前就把整个方法体 JIT 完，类型解析发生在
         * AppDomain.AssemblyResolve 注册**之前**——那样内嵌的
         * Microsoft.Web.WebView2.Core.dll 根本来不及被解析，
         * 进程会直接以 0xE0434352（CLR 未处理异常）退出，且不弹任何框。
         * 所以 Main 只做三件事：挂解析器、备原生 loader、解压页面，
         * 真正碰 WebView2 的代码全部挪进 RunUi。 */
        AppDomain.CurrentDomain.AssemblyResolve += ResolveManaged;

        /* 崩溃取证：WinExe 没有控制台，异常一冒泡进程就直接没了（0xE0434352），
         * 排查只能靠落盘日志。三条通道各管一段：UI 线程异常、非 UI 线程异常、
         * 后台任务未观察异常。 */
        Application.ThreadException += (s, e) => Log("ThreadException", e.Exception);
        AppDomain.CurrentDomain.UnhandledException += (s, e) => Log("UnhandledException", e.ExceptionObject as Exception);
        System.Threading.Tasks.TaskScheduler.UnobservedTaskException += (s, e) => Log("UnobservedTask", e.Exception);
        Log("start", null);

        try { PrepareNative(); }
        catch (Exception ex)
        {
            MessageBox.Show("初始化 WebView2 加载器失败：\n" + ex.Message, AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        string webRoot;
        try { webRoot = EnsurePayload(); }
        catch (Exception ex)
        {
            MessageBox.Show("解压内置页面失败：\n" + ex.Message, AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        try { RunUi(webRoot); }
        catch (Exception ex)
        {
            MessageBox.Show("界面启动失败：\n" + ex, AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    /* 以下方法才引用 WebView2 类型（JIT 时解析器已就位） */
    static void RunUi(string webRoot)
    {
        // DPI 由 app.manifest 的 permonitorv2 声明，代码里不再调 SetHighDpiMode
        // （那是 .NET Core 3+ 的 API，.NET Framework 的编译器编不过）
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        var form = new Form
        {
            Text = AppTitle,
            StartPosition = FormStartPosition.CenterScreen,
            ClientSize = new Size(1180, 880),
            MinimumSize = new Size(840, 600),
            BackColor = Color.FromArgb(247, 243, 234),
            Icon = null
        };
        var view = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.FromArgb(247, 243, 234) };
        form.Controls.Add(view);

        form.Load += async (s, e) =>
        {
            try
            {
                Directory.CreateDirectory(ProfileDir);
                // 排错用：设了 LY_WEBVIEW_ARGS 才加浏览器参数（例如 --remote-debugging-port=9222），
                // 平时不传，不对外开端口
                var dbg = Environment.GetEnvironmentVariable("LY_WEBVIEW_ARGS");
                var envOpts = string.IsNullOrEmpty(dbg) ? null : new CoreWebView2EnvironmentOptions(dbg);
                var env = await CoreWebView2Environment.CreateAsync(null, ProfileDir, envOpts);
                await view.EnsureCoreWebView2Async(env);
                var core = view.CoreWebView2;
                core.SetVirtualHostNameToFolderMapping(Host, webRoot, CoreWebView2HostResourceAccessKind.Allow);
                core.Settings.AreDefaultContextMenusEnabled = true;
                core.Settings.IsStatusBarEnabled = false;
                core.Settings.AreBrowserAcceleratorKeysEnabled = true;
                /* 下载（导出自建卦例库 / 导出整库）：
                 * 无边框壳没有下载栏，默认行为会把文件丢到默认目录还不提示。
                 * 这里直接落到「下载」文件夹并写日志，找不到时能查。 */
                core.DownloadStarting += (a, b) =>
                {
                    try
                    {
                        var name = Path.GetFileName(b.ResultFilePath);
                        var dir = ExportDir();
                        b.ResultFilePath = UniquePath(dir, name);
                        b.Handled = true;
                        Log("Download→ " + b.ResultFilePath, null);
                        var op = b.DownloadOperation;
                        op.StateChanged += (o2, e2) =>
                        {
                            try
                            {
                                if (op.State != CoreWebView2DownloadState.InProgress)
                                    Log("Download " + op.State + " " + op.ResultFilePath, null);
                            }
                            catch { }
                        };
                    }
                    catch (Exception ex) { Log("DownloadStarting", ex); }
                };
                // 站内不再有真实网络：外链（古籍来源等）一律交给系统浏览器
                core.NewWindowRequested += (a, b) =>
                {
                    b.Handled = true;
                    try { System.Diagnostics.Process.Start(b.Uri); } catch { }
                };
                /* 页面 ↔ 壳的文件通道：personal 卦例库落成软件目录下的 JSON 文件，
                 * 不再只躺在 WebView2 的 localStorage（那个 leveldb 谁也看不懂、也没法拷走）。
                 * 协议用「换行分段」而不是 JSON：.NET Framework 4.x 没有内置 JSON 解析，
                 * 手搓解析容易出错；三段文本足够表达 读/写/列目录/打开目录。
                 *   页面→壳： op \n id \n name \n payload
                 *   壳→页面： id \n ok|err \n payload */
                core.WebMessageReceived += (a, b) =>
                {
                    string raw = null;
                    try { raw = b.TryGetWebMessageAsString(); } catch { }
                    if (string.IsNullOrEmpty(raw)) return;
                    var parts = raw.Split(new[] { '\n' }, 4);
                    if (parts.Length < 2) return;
                    var op = parts[0];
                    var id = parts[1];
                    var name = parts.Length > 2 ? parts[2] : "";
                    var payload = parts.Length > 3 ? parts[3] : "";
                    string status = "ok", body = "";
                    bool asyncHandled = false;   // 分支自己回消息时置位（见 ocr）
                    try
                    {
                        switch (op)
                        {
                            case "info":
                                body = DataDir();
                                break;
                            case "list":
                                var sb = new StringBuilder();
                                foreach (var f in Directory.GetFiles(DataDir(), "*.json"))
                                {
                                    var fi = new FileInfo(f);
                                    if (sb.Length > 0) sb.Append('\u0001');
                                    sb.Append(fi.Name).Append('\u0002').Append(fi.Length).Append('\u0002')
                                      .Append(fi.LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss"));
                                }
                                body = sb.ToString();
                                break;
                            case "read":
                                var rp = DataPath(name);
                                body = File.Exists(rp) ? File.ReadAllText(rp, Encoding.UTF8) : "";
                                break;
                            case "write":
                                File.WriteAllText(DataPath(name), payload, new UTF8Encoding(false));
                                body = DataPath(name);
                                break;
                            case "open":
                                var d = DataDir();
                                try { System.Diagnostics.Process.Start("explorer.exe", "\"" + d + "\""); } catch { }
                                body = d;
                                break;
                            case "exportdir":
                                body = ExportDir();
                                break;
                            /* 直接写文件到 导出\ —— 比走浏览器下载可靠：
                             * WebView2 的下载在无边框壳里没有 UI，还会被各种策略拦。
                             * JS 传文本（JSON）或 base64（PNG），壳负责落盘并回传完整路径。 */
                            case "saveexport":
                                var st = UniquePath(ExportDir(), name);
                                File.WriteAllText(st, payload, new UTF8Encoding(false));
                                body = st;
                                Log("Export→ " + st, null);
                                break;
                            case "saveexportb64":
                                var sb2 = UniquePath(ExportDir(), name);
                                File.WriteAllBytes(sb2, Convert.FromBase64String(payload));
                                body = sb2;
                                Log("Export→ " + sb2, null);
                                break;
                            case "openexport":
                                var ed = ExportDir();
                                try { System.Diagnostics.Process.Start("explorer.exe", "\"" + ed + "\""); } catch { }
                                body = ed;
                                break;
                            /* 选一张图（截图导入排盘用）。返回 "文件绝对路径\n图片宽度\n图片高度"；
                             * 用户取消时 status=err、body=CANCEL（页面据此静默返回，不报错）。 */
                            case "pickimage":
                                body = PickImagePath(ref status);
                                break;
                            /* 机器标识：机器名|用户名。同步用它识别「设备号撞车」——
                             * 用户把程序目录拷到另一台机器时，data\同步状态.json 里的
                             * 设备号跟着走，两台机器就自称同一台设备、互相覆盖。
                             * 这个值是「跟机器走」的，正好用来认出来。 */
                            case "machine":
                                body = MachineTag();
                                break;
                            /* 卦例同步：OneDrive 文件夹（本机路径，客户端负责上传） */
                            /* name 里用 \u0002 拆成「动作 + 文件名」：
                             * 协议只有 op/id/name/payload 四段，name 不能含换行。 */
                            case "odsync":
                                {
                                    var seg = (name ?? "").Split(new[] { '\u0002' }, 2);
                                    body = OneDriveSync(seg[0], seg.Length > 1 ? seg[1] : "", payload);
                                }
                                break;
                            /* 卦例同步：WebDAV 代发请求（payload 四行：url/user/pass/body） */
                            case "dav":
                                {
                                    var seg = (name ?? "").Split(new[] { '\u0002' }, 2);
                                    body = WebDav(seg[0], seg.Length > 1 ? seg[1] : "", payload);
                                }
                                break;
                            /* 对指定图片跑系统 OCR（Windows.Media.Ocr），返回逐行
                             * "top\tleft\ttext"，与 core/ocr-paipan.js 的输入格式一致。
                             *
                             * ⚠ 必须丢到后台线程跑：本方法是 WebView2 的 **UI（STA）线程**上的
                             * 同步事件处理器。WinRT 的完成回调要 marshal 回创建它的线程，
                             * 若在那条线程上同步等（GetResult/WaitOne），消息泵被堵住、回调永远
                             * 排不上——表现就是「30 秒超时」（2026-11-17 真机上遇到过）。
                             * 后台（MTA）线程不需要消息泵，算完再 BeginInvoke 回 UI 线程发消息。 */
                            case "ocr":
                                {
                                    var reqId = id;
                                    var reqPath = name;
                                    // 后台（MTA）跑，算完 BeginInvoke 回 UI 线程发消息
                                    System.Threading.Tasks.Task.Run(new Action(() =>
                                    {
                                        string st2 = "ok", bd2 = "";
                                        try { bd2 = OcrImageAsync(reqPath).GetAwaiter().GetResult(); }
                                        catch (Exception ex2) { st2 = "err"; bd2 = ex2.Message; Log("OcrImage", ex2); }
                                        try
                                        {
                                            form.BeginInvoke(new Action(() =>
                                            {
                                                try { core.PostWebMessageAsString(reqId + "\n" + st2 + "\n" + bd2); }
                                                catch { }
                                            }));
                                        }
                                        catch { }
                                    }));
                                    asyncHandled = true;   // 已自行回消息，别再走末尾统一回执
                                }
                                break;
                            default:
                                status = "err"; body = "未知操作 " + op;
                                break;
                        }
                    }
                    catch (Exception ex)
                    {
                        status = "err"; body = ex.Message;
                        Log("FileBridge:" + op, ex);
                    }
                    if (asyncHandled) return;   // 该分支已在后台线程自行回消息
                    try { core.PostWebMessageAsString(id + "\n" + status + "\n" + body); } catch { }
                };

                core.Navigate("https://" + Host + "/index.html");
                core.ProcessFailed += (a, b) => Log("WebViewProcessFailed:" + b.ProcessFailedKind, null);
            }
            catch (Exception ex)
            {
                Log("WebView2Init", ex);
                var msg = ex.Message ?? "";
                if (msg.IndexOf("WebView2", StringComparison.OrdinalIgnoreCase) >= 0 ||
                    msg.IndexOf("runtime", StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    MessageBox.Show(
                        "本机缺少 Microsoft Edge WebView2 运行时，无法显示界面。\n\n" +
                        "Win11 与较新的 Win10 自带该组件；若提示缺失，请安装后重开：\n" +
                        "https://go.microsoft.com/fwlink/p/?LinkId=2124703",
                        AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                }
                else
                {
                    MessageBox.Show("界面初始化失败：\n" + ex, AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Error);
                }
                form.Close();
            }
        };

        Application.Run(form);
    }

    /* ---------- 数据目录（卦例库 JSON 落在这里） ----------
     * 优先 <exe 所在目录>\data —— 绿色版就该「整个文件夹拷走就是全部」。
     * 放 Program Files 之类不可写的位置时，退回 %LOCALAPPDATA%\LianZhaiLiuYao\data。 */
    static string _dataDir;
    static string DataDir()
    {
        if (_dataDir != null) return _dataDir;
        string exeDir = null;
        try { exeDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location); } catch { }
        var candidates = new List<string>();
        if (!string.IsNullOrEmpty(exeDir)) candidates.Add(Path.Combine(exeDir, "data"));
        candidates.Add(Path.Combine(Root, "data"));
        foreach (var dir in candidates)
        {
            try
            {
                Directory.CreateDirectory(dir);
                var probe = Path.Combine(dir, ".writable");
                File.WriteAllText(probe, "1");
                File.Delete(probe);
                _dataDir = dir;
                return dir;
            }
            catch { }
        }
        _dataDir = Root;
        try { Directory.CreateDirectory(_dataDir); } catch { }
        return _dataDir;
    }

    /* 导出（卦例库 JSON / 古籍整库 / 画板截图）统一落到 <exe>\导出\，
     * 与数据放在同一棵树里——王哥要的是「整个文件夹拷走就是全部」。 */
    static string ExportDir()
    {
        var baseDir = Path.GetDirectoryName(DataDir());
        if (string.IsNullOrEmpty(baseDir)) baseDir = DataDir();
        var dir = Path.Combine(baseDir, "导出");
        try { Directory.CreateDirectory(dir); } catch { }
        return dir;
    }

    // 同名不覆盖：xxx.json → xxx (2).json
    static string UniquePath(string dir, string name)
    {
        var target = Path.Combine(dir, name);
        if (!File.Exists(target)) return target;
        var stem = Path.GetFileNameWithoutExtension(name);
        var ext = Path.GetExtension(name);
        for (var i = 2; i < 1000; i++)
        {
            var t = Path.Combine(dir, stem + " (" + i + ")" + ext);
            if (!File.Exists(t)) return t;
        }
        return Path.Combine(dir, stem + "-" + DateTime.Now.ToString("HHmmss") + ext);
    }

    // 只允许简单的文件名，禁止目录穿越
    static string DataPath(string name)
    {
        var safe = new StringBuilder();
        foreach (var ch in (name ?? ""))
        {
            if (char.IsLetterOrDigit(ch) || ch == '-' || ch == '_' || ch == '.' || ch == ' ') safe.Append(ch);
        }
        var n = safe.ToString().Trim();
        if (n.Length == 0) n = "unnamed.json";
        if (!n.EndsWith(".json", StringComparison.OrdinalIgnoreCase)) n += ".json";
        return Path.Combine(DataDir(), n);
    }

    /* ---------- 截图导入排盘：选图 + 系统 OCR ----------
     *
     * 为什么放外壳做：页面（WebView2 里的 JS）没有系统 OCR 的能力，
     * 而 Windows 10/11 自带 Windows.Media.Ocr（中文识别包 zh-Hans-CN 随系统语言装），
     * 不引第三方组件、不联网、不传图——王哥要的「本地 OCR」正是这条。
     *
     * 四个坑（都实测过）：
     *  1. **不能用反射**：WinRT 异步方法返回 System.__ComObject，在它上面
     *     GetProperty("Status") / GetMethod("GetResults") / GetEvent("Completed")
     *     全部返回 null（只有 7 个 Object 基成员）——投影缺失，反射一条路都走不通。
     *     必须编译期引 winmd + System.Runtime.WindowsRuntime，用强类型调用。
     *  2. **不能 await op 直接等**：.NET Framework 的 IAsyncOperation awaiter 来自
     *     扩展方法，实测编译报 CS4028。改用 ToTask() 自己包 TaskCompletionSource。
     *  3. **不能在 UI 线程上同步等**：WinRT 完成回调要 marshal 回创建它的线程，
     *     那条线程若被堵住（GetResult/WaitOne），消息泵不转 → 死锁。
     *     调用方已用 Task.Run 丢到后台（MTA）线程。
     *  4. StorageFile.GetFileFromPathAsync 对含非 ASCII 的路径报
     *     「包含一个或多个无效字符」（实测中文目录直接失败），
     *     所以图片走 File.ReadAllBytes → 内存流（InMemoryRandomAccessStream）。
     */

    /* 弹出系统选图对话框，返回 "路径\n宽\n高"。取消时 status=err / body=CANCEL。 */
    static string PickImagePath(ref string status)
    {
        var dlg = new OpenFileDialog
        {
            Title = "选择排盘截图",
            Filter = "图片|*.png;*.jpg;*.jpeg;*.bmp;*.webp;*.gif;*.tif;*.tiff|所有文件|*.*",
            CheckFileExists = true,
            Multiselect = false
        };
        if (dlg.ShowDialog() != DialogResult.OK) { status = "err"; return "CANCEL"; }
        return dlg.FileName;
    }

    /* 对图片跑系统 OCR，返回逐行 "top\tleft\ttext"（与 ocr-paipan.js 入参同格式）。
     *
     * ⚠ 这里必须用**强类型 WinRT 投影 + async/await**，不能用反射：
     *   WinRT 异步方法返回的是 System.__ComObject，而 System.__ComObject 上
     *   **看不到任何 WinRT 成员**——实测 GetProperty("Status")、GetMethod("GetResults")、
     *   GetEvent("Completed") 全部返回 null（成员只有 7 个 Object 基成员）。
     *   之前那版反射拿不到 Status，就退化成「挂 Completed 事件」，可事件也拿不到，
     *   于是必然 WaitOne 到 30 秒超时。这是 projection 缺失，不是慢。
     * 所以编译期必须带上：
     *   /r:System.Runtime.WindowsRuntime.dll（提供 IAsyncOperation 的 awaiter）
     *   /r:%WINDIR%\System32\WinMetadata\*.winmd（提供 Windows.* 类型）
     *
     * 另外两条实测出来的坑：
     *   ① 不能在 WebView2 的 UI（STA）线程上同步等——WinRT 完成回调要回到同一线程，
     *      而它被堵着，消息泵不转 → 死锁。调用方已用 Task.Run 丢到后台线程。
     *   ② StorageFile.GetFileFromPathAsync 对含非 ASCII 的路径会报
     *      「包含一个或多个无效字符」，所以图片走 File.ReadAllBytes → 内存流。
     */
    /* WinRT 异步 → Task。
     *
     * 为什么不用 await op 直接等：.NET Framework 里 IAsyncOperation<T> 的 awaiter
     * 由 System.Runtime.WindowsRuntime 的扩展方法提供，实测编译报 CS4028
     * 「'await' requires that the type ... have a suitable GetAwaiter method」
     * （Facades 一并引用后扩展方法解析被搅乱）。这里干脆自己包一层 TaskCompletionSource，
     * await 一个原生 Task，不依赖任何扩展方法。 */
    static System.Threading.Tasks.Task<T> ToTask<T>(Windows.Foundation.IAsyncOperation<T> op)
    {
        var tcs = new System.Threading.Tasks.TaskCompletionSource<T>();
        if (op == null) { tcs.SetException(new ArgumentNullException("op")); return tcs.Task; }
        if (op.Status == Windows.Foundation.AsyncStatus.Completed) { tcs.SetResult(op.GetResults()); return tcs.Task; }
        if (op.Status != Windows.Foundation.AsyncStatus.Started)
        {
            tcs.SetException(new InvalidOperationException("WinRT 异步失败：AsyncStatus=" + op.Status));
            return tcs.Task;
        }
        op.Completed = (o, st) =>
        {
            if (st == Windows.Foundation.AsyncStatus.Completed) { try { tcs.SetResult(o.GetResults()); } catch (Exception e) { tcs.SetException(e); } }
            else if (st == Windows.Foundation.AsyncStatus.Canceled) { tcs.SetCanceled(); }
            else { tcs.SetException(new InvalidOperationException("WinRT 异步失败：AsyncStatus=" + st)); }
        };
        return tcs.Task;
    }

    static async System.Threading.Tasks.Task<string> OcrImageAsync(string path)
    {
        if (string.IsNullOrEmpty(path) || !File.Exists(path))
            throw new FileNotFoundException("图片不存在", path);

        var bytes = File.ReadAllBytes(path);
        var stream = new InMemoryRandomAccessStream();
        var writer = new DataWriter(stream);
        writer.WriteBytes(bytes);
        await ToTask(writer.StoreAsync());
        await ToTask(writer.FlushAsync());
        writer.DetachStream();
        stream.Seek(0UL);

        var decoder = await ToTask(BitmapDecoder.CreateAsync(stream));
        var bmp = await ToTask(decoder.GetSoftwareBitmapAsync());
        int w = bmp.PixelWidth, h = bmp.PixelHeight;

        var engine = CreateOcrEngine();
        var result = await ToTask(engine.RecognizeAsync(bmp));

        var sb = new StringBuilder();
        sb.Append("SIZE\t").Append(w).Append('\t').Append(h).Append('\n');
        var ci = System.Globalization.CultureInfo.InvariantCulture;
        foreach (var line in result.Lines)
        {
            double top = double.MaxValue, left = double.MaxValue;
            foreach (var wd in line.Words)
            {
                var r2 = wd.BoundingRect;
                if (r2.Y < top) top = r2.Y;
                if (r2.X < left) left = r2.X;
            }
            if (top == double.MaxValue) { top = 0; left = 0; }
            sb.Append(Math.Round(top).ToString(ci)).Append('\t')
              .Append(Math.Round(left).ToString(ci)).Append('\t')
              .Append(line.Text).Append('\n');
        }
        return sb.ToString();
    }

    /* 建一个中文 OCR 引擎。系统没装中文识别包时抛一条**看得懂**的话。 */
    static OcrEngine CreateOcrEngine()
    {
        var tries = new[] { "zh-Hans-CN", "zh-Hant-TW", System.Globalization.CultureInfo.CurrentUICulture.Name };
        foreach (var tag in tries)
        {
            if (string.IsNullOrEmpty(tag)) continue;
            try
            {
                var eng = OcrEngine.TryCreateFromLanguage(new Language(tag));
                if (eng != null) return eng;
            }
            catch { }
        }
        foreach (var lang in OcrEngine.AvailableRecognizerLanguages)
        {
            var eng = OcrEngine.TryCreateFromLanguage(lang);
            if (eng != null) return eng;
        }
        throw new NotSupportedException(
            "本机没装中文 OCR 识别包。请到「设置 → 时间和语言 → 语言和区域」，" +
            "在中文下添加「可选语言功能 → 光学字符识别」，装完重开程序。\n" +
            "（英文包不够用：排盘表里全是汉字。）");
    }

    /* ---------- 卦例同步：OneDrive 文件夹 + WebDAV ----------
     *
     * 为什么 OneDrive 走「本机文件夹」而不是 WebDAV：
     *   OneDrive 早就没有公开的 WebDAV 端点了（早年 SkyDrive 有，2016 前后关闭），
     *   现在只能靠官方客户端。所以直接把同步文件写进本机 OneDrive 文件夹，
     *   由客户端负责上传/下载——不需要任何令牌，也不需要用户配密码。
     *
     * 为什么 WebDAV 必须放在壳里：
     *   浏览器里发不了 WebDAV 的 PROPFIND（跨域预检必然失败），Basic 认证头
     *   也会被 CORS 拦。所以由 .NET 的 HttpWebRequest 代发，页面只跟壳对话。
     */

    /* 在本机找 OneDrive 同步文件夹。顺序：
     *   ① 环境变量 OneDrive / OneDriveCommercial（最准，装的时候由系统写入）
     *   ② %USERPROFILE%\OneDrive（默认位置）
     *   ③ 注册表 HKCU\Software\Microsoft\OneDrive\Accounts\*\UserFolder
     *      （用户改过位置时只有这里记着；企业版还分 Personal / Business1）
     * 找到的第一个存在的目录就返回；都没有则返回空，由页面提示「未装 OneDrive」。 */
    static string FindOneDriveRoot()
    {
        var cands = new List<string>();
        try
        {
            var e1 = Environment.GetEnvironmentVariable("OneDrive");
            if (!string.IsNullOrEmpty(e1)) cands.Add(e1);
            var e2 = Environment.GetEnvironmentVariable("OneDriveCommercial");
            if (!string.IsNullOrEmpty(e2)) cands.Add(e2);
            var e3 = Environment.GetEnvironmentVariable("OneDriveConsumer");
            if (!string.IsNullOrEmpty(e3)) cands.Add(e3);
        }
        catch { }

        try
        {
            var up = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            if (!string.IsNullOrEmpty(up)) cands.Add(Path.Combine(up, "OneDrive"));
        }
        catch { }

        // 注册表：改过同步位置的用户只能从这里拿到真实路径
        try
        {
            using (var accounts = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(
                @"Software\Microsoft\OneDrive\Accounts"))
            {
                if (accounts != null)
                {
                    foreach (var sub in accounts.GetSubKeyNames())
                    {
                        using (var acct = accounts.OpenSubKey(sub))
                        {
                            if (acct == null) continue;
                            var uf = acct.GetValue("UserFolder") as string;
                            if (!string.IsNullOrEmpty(uf) && !cands.Contains(uf)) cands.Add(uf);
                        }
                    }
                }
            }
        }
        catch { }

        foreach (var c in cands)
        {
            try { if (Directory.Exists(c)) return c; } catch { }
        }
        return "";
    }

    /* 机器标识：机器名 + 用户名的短哈希。
     * 不直接用机器名，是怕把它随同步文件传到网盘上（隐私）。哈希只用来区分机器。 */
    static string MachineTag()
    {
        var raw = "";
        try
        {
            raw = Environment.MachineName + "|" + Environment.UserName;
        }
        catch (Exception ex) { Log("MachineTag", ex); }
        if (string.IsNullOrEmpty(raw)) raw = "unknown";

        // FNV-1a 64 位，两段拼成 16 位十六进制；只求区分度，不需要密码学强度
        ulong h = 14695981039346656037UL;
        foreach (var ch in raw)
        {
            h ^= ch;
            h *= 1099511628211UL;
        }
        var tag = h.ToString("x16");
        return tag.Length > 12 ? tag.Substring(0, 12) : tag;
    }

    /* 同步文件放哪：<OneDrive>\备份配置\莲斋六爻排盘\sync\
     *
     * 王哥 2026-11-18 要求统一放到「备份配置」下（那里已经放了 RimeSync 等
     * 其它备份），所有需要同步的东西都在一个树里，好找也好整体搬走。
     *
     * 旧位置是 <OneDrive>\莲斋六爻排盘\sync。老用户升级后那里可能已经有
     * 别的设备写过的文件，直接换目录会让那些记录「消失」，所以启动/列目录时
     * 先做一次迁移（复制，不删旧文件）。 */
    const string SyncSubDir = @"备份配置\莲斋六爻排盘\sync";
    const string SyncSubDirLegacy = @"莲斋六爻排盘\sync";

    static string SyncDir()
    {
        var od = FindOneDriveRoot();
        if (string.IsNullOrEmpty(od)) return "";
        var dir = Path.Combine(od, SyncSubDir);
        try { Directory.CreateDirectory(dir); } catch { return ""; }
        return dir;
    }

    /* 旧同步目录（升级前用的）。没有就返回空串。 */
    static string LegacySyncDir()
    {
        var od = FindOneDriveRoot();
        if (string.IsNullOrEmpty(od)) return "";
        var dir = Path.Combine(od, SyncSubDirLegacy);
        try { return Directory.Exists(dir) ? dir : ""; } catch { return ""; }
    }

    /* 把旧目录里的同步文件搬到新目录。
     * 只复制新目录里**还没有**的文件：两边都有时以新目录为准（它才是当前在用的），
     * 不覆盖，免得出问题。旧文件不动——删别人的数据必须有明确指令。 */
    static void MigrateLegacySync()
    {
        try
        {
            var oldDir = LegacySyncDir();
            if (string.IsNullOrEmpty(oldDir)) return;
            var newDir = SyncDir();
            if (string.IsNullOrEmpty(newDir) || string.Equals(oldDir, newDir, StringComparison.OrdinalIgnoreCase)) return;
            foreach (var f in Directory.GetFiles(oldDir, "*.json"))
            {
                var target = Path.Combine(newDir, Path.GetFileName(f));
                if (File.Exists(target)) continue;      // 新目录已有，不覆盖
                try { File.Copy(f, target, false); Log("同步目录迁移→ " + target, null); }
                catch (Exception ex) { Log("同步目录迁移失败 " + f, ex); }
            }
        }
        catch (Exception ex) { Log("MigrateLegacySync", ex); }
    }

    /* 只允许 <deviceId>.json 这种名字，防目录穿越 */
    static string SyncPath(string name)
    {
        var safe = new StringBuilder();
        foreach (var ch in (name ?? ""))
        {
            if (char.IsLetterOrDigit(ch) || ch == '-' || ch == '_' || ch == '.') safe.Append(ch);
        }
        var n = safe.ToString().Trim();
        if (n.Length == 0 || n == ".json") throw new InvalidOperationException("同步文件名非法");
        if (!n.EndsWith(".json", StringComparison.OrdinalIgnoreCase)) n += ".json";
        var dir = SyncDir();
        if (string.IsNullOrEmpty(dir)) throw new InvalidOperationException("找不到 OneDrive 文件夹");
        return Path.Combine(dir, n);
    }

    /* OneDrive 同步通道。
     *   action=dir   → 返回同步目录（找不到 OneDrive 时返回空串，不抛错）
     *   action=list  → 返回 "\u0001" 分隔的文件名
     *   action=read  → 返回文件正文（不存在返回空串）
     *   action=write → 写文件，返回路径
     */
    static string OneDriveSync(string action, string name, string payload)
    {
        if (string.Equals(action, "dir", StringComparison.OrdinalIgnoreCase))
            return SyncDir();
        if (string.Equals(action, "list", StringComparison.OrdinalIgnoreCase))
        {
            /* 列目录前先把旧位置的文件迁过来：用户升级后第一次同步就能看到
             * 之前同步过的内容，不会以为「记录丢了」。 */
            MigrateLegacySync();
            var dir = SyncDir();
            if (string.IsNullOrEmpty(dir)) return "";
            var sb = new StringBuilder();
            foreach (var f in Directory.GetFiles(dir, "*.json"))
            {
                if (sb.Length > 0) sb.Append('\u0001');
                sb.Append(Path.GetFileName(f));
            }
            return sb.ToString();
        }
        if (string.Equals(action, "read", StringComparison.OrdinalIgnoreCase))
        {
            var p = SyncPath(name);
            return File.Exists(p) ? File.ReadAllText(p, Encoding.UTF8) : "";
        }
        if (string.Equals(action, "write", StringComparison.OrdinalIgnoreCase))
        {
            var p = SyncPath(name);
            /* 先写临时文件再替换：OneDrive 客户端会盯着目录，
             * 直接覆盖可能被它读到一个写了一半的文件（然后同步出去半份）。 */
            var tmp = p + ".tmp";
            File.WriteAllText(tmp, payload ?? "", new UTF8Encoding(false));
            try
            {
                if (File.Exists(p)) File.Delete(p);
                File.Move(tmp, p);
            }
            catch
            {
                // 被占用（OneDrive 正在上传）时退化成直接写，至少别丢数据
                try { File.WriteAllText(p, payload ?? "", new UTF8Encoding(false)); } catch { }
                try { if (File.Exists(tmp)) File.Delete(tmp); } catch { }
            }
            return p;
        }
        throw new InvalidOperationException("未知的 OneDrive 动作：" + action);
    }

    /* WebDAV 通道。name 形如 "LIST" / "READ <file>" / "WRITE <file>"，
     * payload 四行：url \n user \n pass \n body。
     *
     * 手搓 XML 只为 LIST：PROPFIND 的响应要解析出文件名。
     * 不用 System.Xml 是因为壳走内嵌资源、只引了最小程序集；正则足够稳
     * （只管 <d:href>，任何前缀都认）。 */
    static string WebDav(string verb, string name, string payload)
    {
        // XML 里的引号：用 char 拼，躲开 C# 字符串转义（直接写 \" 极易出错）
        const char Q = '"';
        var lines = (payload ?? "").Split(new[] { '\n' }, 4);
        var url = lines.Length > 0 ? lines[0].Trim() : "";
        var user = lines.Length > 1 ? lines[1] : "";
        var pass = lines.Length > 2 ? lines[2] : "";
        var body = lines.Length > 3 ? lines[3] : "";
        if (string.IsNullOrEmpty(url)) throw new InvalidOperationException("WebDAV 地址为空");

        var baseUrl = url.TrimEnd('/');
        var file = (name ?? "").Trim();
        // 文件名只允许简单字符：排盘生成的设备号都是这个形态
        if (file.Length > 0)
        {
            var safe = new StringBuilder();
            foreach (var ch in file)
            {
                if (char.IsLetterOrDigit(ch) || ch == '-' || ch == '_' || ch == '.') safe.Append(ch);
            }
            if (safe.Length == 0) throw new InvalidOperationException("WebDAV 文件名非法");
            file = safe.ToString();
            if (!file.EndsWith(".json", StringComparison.OrdinalIgnoreCase)) file += ".json";
        }

        var v = (verb ?? "").Trim().ToUpperInvariant();
        string target;
        string method;
        if (v == "LIST")
        {
            // 目录本身必须带斜杠，否则某些服务端会 301
            target = baseUrl + "/";
            method = "PROPFIND";
        }
        else if (v == "READ")
        {
            target = baseUrl + "/" + Uri.EscapeDataString(file);
            method = "GET";
        }
        else if (v == "WRITE")
        {
            target = baseUrl + "/" + Uri.EscapeDataString(file);
            method = "PUT";
        }
        else
        {
            throw new InvalidOperationException("未知的 WebDAV 动作：" + verb);
        }

        var req = (System.Net.HttpWebRequest)System.Net.WebRequest.Create(target);
        req.Method = method;
        req.Timeout = 30000;
        req.ReadWriteTimeout = 60000;
        req.UserAgent = "LianZhaiLiuYao/" + AppTitle;
        req.AllowAutoRedirect = true;
        if (!string.IsNullOrEmpty(user) || !string.IsNullOrEmpty(pass))
        {
            req.Headers["Authorization"] = "Basic " + Convert.ToBase64String(
                Encoding.UTF8.GetBytes((user ?? "") + ":" + (pass ?? "")));
        }

        if (method == "PROPFIND")
        {
            req.Headers["Depth"] = "1";
            req.ContentType = "application/xml; charset=utf-8";
            var xml = "<?xml version=" + Q + "1.0" + Q + " encoding=" + Q + "utf-8" + Q + "?>" +
                      "<d:propfind xmlns:d=" + Q + "DAV:" + Q + "><d:prop><d:resourcetype/></d:prop></d:propfind>";
            var bytes = Encoding.UTF8.GetBytes(xml);
            req.ContentLength = bytes.Length;
            using (var s = req.GetRequestStream()) s.Write(bytes, 0, bytes.Length);
        }
        else if (method == "PUT")
        {
            var bytes = new UTF8Encoding(false).GetBytes(body ?? "");
            req.ContentType = "application/json; charset=utf-8";
            req.ContentLength = bytes.Length;
            using (var s = req.GetRequestStream()) s.Write(bytes, 0, bytes.Length);
        }

        try
        {
            using (var resp = (System.Net.HttpWebResponse)req.GetResponse())
            using (var rs = resp.GetResponseStream())
            using (var sr = new StreamReader(rs, Encoding.UTF8))
            {
                return sr.ReadToEnd();
            }
        }
        catch (System.Net.WebException we)
        {
            /* WebDAV 的 404 / 409 在 .NET 里都表现成 WebException。
             * 404 对 READ 是正常情况（远端还没有这个文件），返回空串让它继续；
             * 别的错误把状态码和正文带出来，不然用户只看到「远程服务器返回错误」。 */
            var r = we.Response as System.Net.HttpWebResponse;
            if (r != null)
            {
                int code = (int)r.StatusCode;
                string detail = "";
                try
                {
                    using (var es = r.GetResponseStream())
                    using (var er = new StreamReader(es, Encoding.UTF8))
                        detail = er.ReadToEnd();
                }
                catch { }
                if (code == 404 && method == "GET") return "";
                if (detail.Length > 300) detail = detail.Substring(0, 300);
                var hint = code == 401
                    ? "（账号或密码不对，很多服务商要用「应用密码」而不是登录密码）"
                    : (code == 404 ? "（地址不对，或这个目录还不存在）"
                    : (code == 403 ? "（没有权限）" : ""));
                throw new InvalidOperationException(
                    "WebDAV " + method + " 失败：HTTP " + code + hint +
                    (detail.Length > 0 ? "\n" + detail : ""));
            }
            throw new InvalidOperationException("WebDAV " + method + " 失败：" + we.Message);
        }
    }

    /* ---------- 崩溃日志 ---------- */

    static void Log(string tag, Exception ex)
    {
        try
        {
            Directory.CreateDirectory(Root);
            var path = Path.Combine(Root, "log.txt");
            var sb = new StringBuilder();
            sb.AppendLine("[" + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "] " + tag);
            if (ex != null) sb.AppendLine(ex.ToString());
            sb.AppendLine("----");
            File.AppendAllText(path, sb.ToString(), Encoding.UTF8);
        }
        catch { }
    }

    /* ---------- 内嵌资源 → 磁盘 ---------- */

    static string Stamp()
    {
        // 用 exe 的修改时间做版本标：重新构建 → 时间变 → 页面重铺
        try
        {
            var p = Assembly.GetExecutingAssembly().Location;
            return new FileInfo(p).LastWriteTimeUtc.Ticks.ToString();
        }
        catch { return "0"; }
    }

    static string EnsurePayload()
    {
        Directory.CreateDirectory(WebDir);
        var marker = Path.Combine(WebDir, ".version");
        var stamp = Stamp();
        if (File.Exists(marker) && File.Exists(Path.Combine(WebDir, "index.html")))
        {
            try
            {
                if (File.ReadAllText(marker).Trim() == stamp) { MergeExternalGuji(); return WebDir; }
            }
            catch { }
        }

        // 清空旧页面（不动 profile，用户的历史卦例在 localStorage 里）
        foreach (var f in Directory.GetFiles(WebDir)) { try { File.Delete(f); } catch { } }
        foreach (var d in Directory.GetDirectories(WebDir)) { try { Directory.Delete(d, true); } catch { } }

        using (var s = OpenResource("payload.zip"))
        using (var zip = new ZipArchive(s, ZipArchiveMode.Read))
        {
            foreach (var entry in zip.Entries)
            {
                if (string.IsNullOrEmpty(entry.Name) && entry.FullName.EndsWith("/"))
                {
                    Directory.CreateDirectory(Path.Combine(WebDir, entry.FullName.Replace('/', Path.DirectorySeparatorChar)));
                    continue;
                }
                var target = Path.Combine(WebDir, entry.FullName.Replace('/', Path.DirectorySeparatorChar));
                Directory.CreateDirectory(Path.GetDirectoryName(target));
                entry.ExtractToFile(target, true);
            }
        }
        File.WriteAllText(marker, stamp, Encoding.UTF8);

        /* 页面换了，WebView2 的 HTTP 缓存必须一起清：
         * 它按 URL 缓存响应，磁盘文件重写不影响已有缓存条目。脚本 URL 上的 ?v=
         * 长期不变，于是「换了 exe 但页面还是旧的」——王哥几次遇到「改了没生效」
         * 都是这个原因。这里只删可再生的缓存目录，profile 里的 localStorage（卦例、
         * 配置）不动。 */
        PurgeWebCache();

        MergeExternalGuji();
        return WebDir;
    }

    static void PurgeWebCache()
    {
        var names = new[] { "Cache", "Code Cache", "GPUCache", "DawnGraphiteCache", "DawnWebGPUCache", "Service Worker" };
        // WebView2 的实际用户数据在 profile\EBWebView，缓存又在它的 Default 下
        var roots = new[]
        {
            ProfileDir,
            Path.Combine(ProfileDir, "EBWebView"),
            Path.Combine(ProfileDir, "EBWebView", "Default"),
            Path.Combine(ProfileDir, "Default")
        };
        foreach (var root in roots)
        {
            foreach (var name in names)
            {
                var p = Path.Combine(root, name);
                try { if (Directory.Exists(p)) Directory.Delete(p, true); } catch { }
            }
        }
    }

    /* 古籍书籍与卦例（约 4.6MB）不进仓库，改为外置：
     *   <exe 所在目录>\guji\        ← 绿色版的自然位置，拷文件夹就带走了
     *   %LOCALAPPDATA%\LianZhaiLiuYao\guji\   ← 不想在程序目录放东西时用这个
     * 每次启动都覆盖一次（内容小，代价低），这样换新版 exe 也不会把书弄丢，
     * 用户自己往里加的书也是同一份。内嵌包若自带 guji/ 则以此处为准。 */
    static void MergeExternalGuji()
    {
        try
        {
            string exeDir = null;
            try { exeDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location); } catch { }
            var candidates = new List<string>();
            if (!string.IsNullOrEmpty(exeDir)) candidates.Add(Path.Combine(exeDir, "guji"));
            candidates.Add(Path.Combine(Root, "guji"));

            foreach (var src in candidates)
            {
                if (!Directory.Exists(src)) continue;
                if (!File.Exists(Path.Combine(src, "manifest.json"))) continue;   // 不是数据包目录
                var dst = Path.Combine(WebDir, "guji");
                CopyDir(src, dst);
                Log("已载入外置古籍数据: " + src, null);
                return;
            }
        }
        catch (Exception ex) { Log("MergeExternalGuji 失败", ex); }
    }

    static void CopyDir(string src, string dst)
    {
        Directory.CreateDirectory(dst);
        foreach (var f in Directory.GetFiles(src))
            File.Copy(f, Path.Combine(dst, Path.GetFileName(f)), true);
        foreach (var d in Directory.GetDirectories(src))
            CopyDir(d, Path.Combine(dst, Path.GetFileName(d)));
    }

    static void PrepareNative()
    {
        Directory.CreateDirectory(BinDir);
        var loader = Path.Combine(BinDir, "WebView2Loader.dll");
        using (var s = OpenResource("WebView2Loader.dll"))
        using (var fs = File.Create(loader)) { s.CopyTo(fs); }
        // 先预加载 + 设定搜索目录：Core.dll 的 DllImport("WebView2Loader.dll") 才能命中
        SetDllDirectoryW(BinDir);
        var h = LoadLibraryW(loader);
        if (h == IntPtr.Zero)
            throw new Exception("WebView2Loader.dll 加载失败（Win32 错误 " + Marshal.GetLastWin32Error() + "）");
    }

    static Stream OpenResource(string name)
    {
        var asm = Assembly.GetExecutingAssembly();
        foreach (var n in asm.GetManifestResourceNames())
        {
            if (n.Equals(name, StringComparison.OrdinalIgnoreCase) || n.EndsWith("." + name, StringComparison.OrdinalIgnoreCase))
            {
                var s = asm.GetManifestResourceStream(n);
                if (s != null) return s;
            }
        }
        throw new Exception("内置资源缺失：" + name);
    }

    static Assembly ResolveManaged(object sender, ResolveEventArgs args)
    {
        var simple = new AssemblyName(args.Name).Name;
        var asm = Assembly.GetExecutingAssembly();
        var target = simple + ".dll";
        foreach (var n in asm.GetManifestResourceNames())
        {
            // 资源名是 /resource:<file>,<name> 里的 <name>，通常就是「Microsoft.Web.WebView2.Core.dll」
            // 这种**不带前导点**的裸文件名；早期只判 EndsWith(".XXX.dll") 会漏掉裸名，
            // 表现为 FileNotFoundException 说「找到了清单但缺依赖」。
            if (!n.Equals(target, StringComparison.OrdinalIgnoreCase) &&
                !n.EndsWith("." + target, StringComparison.OrdinalIgnoreCase)) continue;
            using (var s = asm.GetManifestResourceStream(n))
            {
                if (s == null) continue;
                var buf = new byte[s.Length];
                s.Read(buf, 0, buf.Length);
                return Assembly.Load(buf);
            }
        }
        Log("ResolveManaged 未命中: " + args.Name + "（现有资源：" + string.Join(",", asm.GetManifestResourceNames()) + "）", null);
        return null;
    }
}
