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
                        var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
                        Directory.CreateDirectory(dir);
                        b.ResultFilePath = Path.Combine(dir, name);
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
