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
        // 托管依赖必须先挂上解析器，晚一步 Core.dll 就找不到了
        AppDomain.CurrentDomain.AssemblyResolve += ResolveManaged;
        try { Application.SetHighDpiMode(HighDpiMode.PerMonitorV2); } catch { }
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        string webRoot;
        try { webRoot = EnsurePayload(); }
        catch (Exception ex)
        {
            MessageBox.Show("解压内置页面失败：\n" + ex.Message, AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }
        try { PrepareNative(); }
        catch (Exception ex)
        {
            MessageBox.Show("初始化 WebView2 加载器失败：\n" + ex.Message, AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

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
                var env = await CoreWebView2Environment.CreateAsync(null, ProfileDir, null);
                await view.EnsureCoreWebView2Async(env);
                var core = view.CoreWebView2;
                core.SetVirtualHostNameToFolderMapping(Host, webRoot, CoreWebView2HostResourceAccessKind.Allow);
                core.Settings.AreDefaultContextMenusEnabled = true;
                core.Settings.IsStatusBarEnabled = false;
                core.Settings.AreBrowserAcceleratorKeysEnabled = true;
                // 站内不再有真实网络：外链（古籍来源等）一律交给系统浏览器
                core.NewWindowRequested += (a, b) =>
                {
                    b.Handled = true;
                    try { System.Diagnostics.Process.Start(b.Uri); } catch { }
                };
                core.Navigate("https://" + Host + "/index.html");
            }
            catch (Exception ex)
            {
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
            try { if (File.ReadAllText(marker).Trim() == stamp) return WebDir; } catch { }
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
        return WebDir;
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
        foreach (var n in asm.GetManifestResourceNames())
        {
            if (!n.EndsWith("." + simple + ".dll", StringComparison.OrdinalIgnoreCase)) continue;
            using (var s = asm.GetManifestResourceStream(n))
            {
                if (s == null) continue;
                var buf = new byte[s.Length];
                s.Read(buf, 0, buf.Length);
                return Assembly.Load(buf);
            }
        }
        return null;
    }
}
