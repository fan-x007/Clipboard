# IME English Symbols Hook
# Installs a global low-level keyboard hook. When enabled, punctuation keys
# are swallowed and re-injected as exact ASCII symbols via KEYEVENTF_UNICODE,
# so the Chinese IME cannot convert them into full-width punctuation.
# Control via stdin: ON / OFF / EXIT

$ErrorActionPreference = 'Stop'

$code = @'
using System;
using System.Runtime.InteropServices;

public class ImeHook {
    public delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll")]
    public static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll")]
    public static extern IntPtr GetModuleHandle(string lpModuleName);

    [DllImport("kernel32.dll")]
    public static extern uint GetCurrentThreadId();

    [DllImport("user32.dll")]
    public static extern bool PostThreadMessage(uint threadId, uint msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern short GetAsyncKeyState(int vKey);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    [StructLayout(LayoutKind.Sequential)]
    public struct KBDLLHOOKSTRUCT {
        public uint vkCode;
        public uint scanCode;
        public uint flags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT {
        public uint type;
        public KEYBDINPUT ki;
        public uint padding1;
        public uint padding2;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MSG {
        public IntPtr hwnd;
        public uint message;
        public IntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public int ptX;
        public int ptY;
    }

    public static volatile bool Enabled = false;

    static IntPtr hookId = IntPtr.Zero;
    static uint mainThreadId = 0;

    // Auto-flushing stdout writer (Console.Out may be wrapped by the host without AutoFlush)
    static System.IO.StreamWriter outWriter;
    public static void Out(string s) {
        if (outWriter == null) {
            outWriter = new System.IO.StreamWriter(System.Console.OpenStandardOutput(), new System.Text.UTF8Encoding(false));
            outWriter.AutoFlush = true;
        }
        outWriter.WriteLine(s);
    }

    const int WH_KEYBOARD_LL = 13;
    const int WM_KEYDOWN = 0x0100;
    const int WM_SYSKEYDOWN = 0x0104;
    const int WM_QUIT = 0x0012;
    const int LLKHF_INJECTED = 0x10;
    const uint INPUT_KEYBOARD = 1;
    const uint KEYEVENTF_KEYUP = 2;
    const uint KEYEVENTF_UNICODE = 4;

    // Map a virtual key (with current shift state) to the ASCII symbol it
    // produces on a US layout. Returns null when the key is not a symbol.
    public static string MapKey(uint vk, bool shift) {
        switch (vk) {
            case 0xBA: return shift ? ":" : ";";
            case 0xBB: return shift ? "+" : "=";
            case 0xBC: return shift ? "<" : ",";
            case 0xBD: return shift ? "_" : "-";
            case 0xBE: return shift ? ">" : ".";
            case 0xBF: return shift ? "?" : "/";
            case 0xC0: return shift ? "~" : "`";
            case 0xDB: return shift ? "{" : "[";
            case 0xDC: return shift ? "|" : "\\";
            case 0xDD: return shift ? "}" : "]";
            case 0xDE: return shift ? "\"" : "'";
            case 0x30: return shift ? ")" : null;
            case 0x31: return shift ? "!" : null;
            case 0x32: return shift ? "@" : null;
            case 0x33: return shift ? "#" : null;
            case 0x34: return shift ? "$" : null;
            case 0x35: return shift ? "%" : null;
            case 0x36: return shift ? "^" : null;
            case 0x37: return shift ? "&" : null;
            case 0x38: return shift ? "*" : null;
            case 0x39: return shift ? "(" : null;
            default: return null;
        }
    }

    // Inject a character directly, bypassing the keyboard layout and IME
    public static void SendUnicodeChar(char c) {
        INPUT[] inp = new INPUT[2];
        inp[0].type = INPUT_KEYBOARD;
        inp[0].ki.wScan = c;
        inp[0].ki.dwFlags = KEYEVENTF_UNICODE;
        inp[1].type = INPUT_KEYBOARD;
        inp[1].ki.wScan = c;
        inp[1].ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
        SendInput(2, inp, Marshal.SizeOf(typeof(INPUT)));
    }

    public static void SendUnicodeString(string s) {
        foreach (char c in s) {
            SendUnicodeChar(c);
        }
    }

    public static IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam) {
        if (nCode >= 0 && Enabled) {
            int msg = wParam.ToInt32();
            if (msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN) {
                KBDLLHOOKSTRUCT info = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
                bool injected = (info.flags & LLKHF_INJECTED) != 0;
                if (!injected) {
                    bool ctrl = (GetAsyncKeyState(0x11) & 0x8000) != 0;
                    bool alt = (GetAsyncKeyState(0x12) & 0x8000) != 0;
                    bool win = ((GetAsyncKeyState(0x5B) | GetAsyncKeyState(0x5C)) & 0x8000) != 0;
                    if (!ctrl && !alt && !win) {
                        bool shift = (GetAsyncKeyState(0x10) & 0x8000) != 0;
                        string symbol = MapKey(info.vkCode, shift);
                        if (symbol != null) {
                            SendUnicodeString(symbol);
                            return (IntPtr)1; // swallow the original key
                        }
                    }
                }
            }
        }
        return CallNextHookEx(hookId, nCode, wParam, lParam);
    }

    public static void Start() {
        hookId = SetWindowsHookEx(WH_KEYBOARD_LL, HookProc, GetModuleHandle(null), 0);
        mainThreadId = GetCurrentThreadId();
        if (hookId == IntPtr.Zero) {
            Out("HOOK:FAIL:" + Marshal.GetLastWin32Error());
            return;
        }
        Out("HOOK:OK");
        MSG msg;
        while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) { }
        UnhookWindowsHookEx(hookId);
        hookId = IntPtr.Zero;
    }

    public static void Stop() {
        PostThreadMessage(mainThreadId, WM_QUIT, IntPtr.Zero, IntPtr.Zero);
    }

    [DllImport("user32.dll")]
    public static extern int GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);
}
'@

Add-Type -TypeDefinition $code -Language CSharp
[ImeHook]::Out("COMPILE:OK")

# Background thread: read commands from stdin and toggle the hook flag
$rs = [runspacefactory]::CreateRunspace()
$rs.Open()
$ps = [powershell]::Create()
$ps.Runspace = $rs
$null = $ps.AddScript({
    while ($true) {
        $line = [Console]::In.ReadLine()
        if ($null -eq $line) { break }
        $cmd = $line.Trim().ToUpperInvariant()
        if ($cmd -eq 'ON') {
            [ImeHook]::Enabled = $true
            [ImeHook]::Out("STATE:ON")
        } elseif ($cmd -eq 'OFF') {
            [ImeHook]::Enabled = $false
            [ImeHook]::Out("STATE:OFF")
        } elseif ($cmd -eq 'EXIT') {
            [ImeHook]::Stop()
            break
        }
    }
})
$null = $ps.BeginInvoke()

# Install the hook and run the message loop on the main thread (blocking)
[ImeHook]::Enabled = $false
[ImeHook]::Start()
