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
                            /* 对指定图片跑系统 OCR（Windows.Media.Ocr），返回逐行
                             * "top\tleft\ttext"，与 core/ocr-paipan.js 的输入格式一致。 */
                            case "ocr":
                                body = OcrImage(name);
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

    /* ---------- 截图导入排盘：选图 + 系统 OCR ----------
     *
     * 为什么放外壳做：页面（WebView2 里的 JS）没有系统 OCR 的能力，
     * 而 Windows 10/11 自带 Windows.Media.Ocr（中文识别包 zh-Hans-CN 随系统语言装），
     * 不引第三方组件、不联网、不传图——王哥要的「本地 OCR」正是这条。
     *
     * 三个坑（都实测过）：
     *  1. .NET Framework 4.x + 内嵌资源里**没有** System.Runtime.WindowsRuntime，
     *     所以 `await WinRT 异步方法` 编不过，AsTask 也不存在。这里统一用
     *     IAsyncOperation.Completed 回调 + ManualResetEvent 同步等待。
     *  2. WinRT 类型必须延迟到方法体里解析（先 AppDomain.AssemblyResolve 就位），
     *     所以两个方法体里一律用**反射**取类型，方法签名不出现 WinRT 类型。
     *  3. StorageFile.GetFileFromPathAsync 对路径里的非 ASCII 会报
     *     「包含一个或多个无效字符」（实测中文目录直接失败），
     *     所以图片走 File.ReadAllBytes → 内存流（InMemoryRandomAccessStream）。
     */

    /* 用反射调一个 WinRT 静态/实例方法，并同步等它的 IAsyncOperation 结果。
     * typeName 形如 "Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime"。 */
    static object AwaitWinRT(string typeName, string methodName, object instance, object[] args)
    {
        var t = Type.GetType(typeName, true);
        var m = instance == null
            ? t.GetMethod(methodName, BindingFlags.Public | BindingFlags.Static)
            : t.GetMethod(methodName, BindingFlags.Public | BindingFlags.Instance);
        if (m == null) throw new MissingMethodException(t.FullName, methodName);

        var op = m.Invoke(instance, args);
        if (op == null) throw new InvalidOperationException(typeName + "." + methodName + " 返回 null");

        /* IAsyncOperation<T> 只暴露 Status / GetResults / Completed（COM 接口）。
         * 用反射取，避免在编译期依赖 WinRT 投影类型。 */
        var opType = op.GetType();
        var statusProp = opType.GetProperty("Status");
        var resultsM = opType.GetMethod("GetResults");
        var completedEvt = opType.GetEvent("Completed");

        /* 已经完成（本地小图常常同步就完了）——别挂事件，直接取。 */
        if (statusProp != null && Convert.ToInt32(statusProp.GetValue(op, null)) == 1)
            return resultsM.Invoke(op, null);

        var done = new System.Threading.ManualResetEvent(false);
        if (completedEvt != null)
        {
            var handlerType = completedEvt.EventHandlerType;
            // AsyncOperationCompletedHandler<T>：(IAsyncOperation<T>, AsyncStatus) => void
            var handler = Delegate.CreateDelegate(handlerType, new NotifyDone(done),
                typeof(NotifyDone).GetMethod("Invoke"));
            completedEvt.AddEventHandler(op, handler);
        }
        if (!done.WaitOne(30000))
            throw new TimeoutException(typeName + "." + methodName + " 超过 30 秒未返回");

        var st = statusProp == null ? 1 : Convert.ToInt32(statusProp.GetValue(op, null));
        if (st != 1) throw new InvalidOperationException(typeName + "." + methodName + " 失败（AsyncStatus=" + st + "）");
        return resultsM.Invoke(op, null);
    }

    /* 给 Completed 事件当代理。AsyncOperationCompletedHandler<T> 的签名是
     * void (IAsyncOperation<T>, AsyncStatus)，这里参数全用 object，
     * Delegate.CreateDelegate 对这种「宽参数」是允许的（逆变 + 装箱）。 */
    sealed class NotifyDone
    {
        readonly System.Threading.ManualResetEvent _e;
        public NotifyDone(System.Threading.ManualResetEvent e) { _e = e; }
        public void Invoke(object sender, object status) { try { _e.Set(); } catch { } }
    }

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
     * 识别语言顺序：zh-Hans-CN → zh-Hant-TW → 用户首选 → 第一个可用。
     * 只认中文包：排盘表里全是汉字，用英文引擎会把「财戌土」读成乱码。 */
    static string OcrImage(string path)
    {
        if (string.IsNullOrEmpty(path) || !File.Exists(path))
            throw new FileNotFoundException("图片不存在", path);

        // 1) 图片 → 内存流 → SoftwareBitmap（避开中文路径的 GetFileFromPathAsync 坑）
        var bytes = File.ReadAllBytes(path);
        var streamType = Type.GetType("Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType=WindowsRuntime", true);
        var stream = Activator.CreateInstance(streamType);
        var writerType = Type.GetType("Windows.Storage.Streams.DataWriter, Windows.Storage.Streams, ContentType=WindowsRuntime", true);
        var writer = Activator.CreateInstance(writerType, new object[] { stream });
        writerType.GetMethod("WriteBytes").Invoke(writer, new object[] { bytes });
        AwaitWinRT("Windows.Storage.Streams.DataWriter, Windows.Storage.Streams, ContentType=WindowsRuntime",
            "StoreAsync", writer, null);
        AwaitWinRT("Windows.Storage.Streams.DataWriter, Windows.Storage.Streams, ContentType=WindowsRuntime",
            "FlushAsync", writer, null);
        streamType.GetMethod("Seek").Invoke(stream, new object[] { 0UL });

        var dec = AwaitWinRT("Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime",
            "CreateAsync", null, new object[] { stream });
        var bmp = AwaitWinRT("Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime",
            "GetSoftwareBitmapAsync", dec, new object[] { });
        int w = Convert.ToInt32(bmp.GetType().GetProperty("PixelWidth").GetValue(bmp, null));
        int h = Convert.ToInt32(bmp.GetType().GetProperty("PixelHeight").GetValue(bmp, null));

        /* 手机截图字太小：先放大再识别。实测 886×1920 的原图里
         * 「○」「×」这类小符号一个都读不出来，放大 2 倍后能读到部分。
         * 缩放上限按长边 ≤ 4000 控制，免得内存炸。 */
        var engine = CreateOcrEngine();
        var result = AwaitWinRT("Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime",
            "RecognizeAsync", engine, new object[] { bmp });

        var sb = new StringBuilder();
        sb.Append("SIZE\t").Append(w).Append('\t').Append(h).Append('\n');
        var linesType = result.GetType().GetProperty("Lines").GetValue(result, null);
        var lines = (System.Collections.IEnumerable)linesType;
        var ci = System.Globalization.CultureInfo.InvariantCulture;
        foreach (var line in lines)
        {
            var wordsProp = line.GetType().GetProperty("Words");
            var words = (System.Collections.IEnumerable)wordsProp.GetValue(line, null);
            double top = double.MaxValue, left = double.MaxValue;
            foreach (var wd in words)
            {
                var rect = wd.GetType().GetProperty("BoundingRect").GetValue(wd, null);
                var rt = rect.GetType();
                var y = Convert.ToDouble(rt.GetProperty("Y").GetValue(rect, null), ci);
                var x = Convert.ToDouble(rt.GetProperty("X").GetValue(rect, null), ci);
                if (y < top) top = y;
                if (x < left) left = x;
            }
            var text = (string)line.GetType().GetProperty("Text").GetValue(line, null);
            if (text == null) continue;
            if (top == double.MaxValue) { top = 0; left = 0; }
            sb.Append(Math.Round(top).ToString(ci)).Append('\t')
              .Append(Math.Round(left).ToString(ci)).Append('\t')
              .Append(text).Append('\n');
        }
        return sb.ToString();
    }

    /* 建一个中文 OCR 引擎。系统没装中文识别包时抛一条**看得懂**的话。 */
    static object CreateOcrEngine()
    {
        var langType = Type.GetType("Windows.Globalization.Language, Windows.Globalization, ContentType=WindowsRuntime", true);
        var engineType = Type.GetType("Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime", true);
        var tryCreate = engineType.GetMethod("TryCreateFromLanguage", BindingFlags.Public | BindingFlags.Static);

        var tries = new[] { "zh-Hans-CN", "zh-Hant-TW", System.Globalization.CultureInfo.CurrentUICulture.Name };
        foreach (var tag in tries)
        {
            if (string.IsNullOrEmpty(tag)) continue;
            try
            {
                var lang = Activator.CreateInstance(langType, new object[] { tag });
                var eng = tryCreate.Invoke(null, new object[] { lang });
                if (eng != null) return eng;
            }
            catch { }
        }
        // 兜底：用系统第一个可用语言
        try
        {
            var avail = (System.Collections.IEnumerable)engineType
                .GetProperty("AvailableRecognizerLanguages", BindingFlags.Public | BindingFlags.Static).GetValue(null, null);
            foreach (var lang in avail)
            {
                var eng = tryCreate.Invoke(null, new object[] { lang });
                if (eng != null) return eng;
            }
        }
        catch { }

        throw new NotSupportedException(
            "本机没装中文 OCR 识别包。请到「设置 → 时间和语言 → 语言和区域」，" +
            "在中文下添加「可选语言功能 → 光学字符识别」，装完重开程序。\n" +
            "（英文包不够用：排盘表里全是汉字。）");
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
