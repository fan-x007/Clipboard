# Auto Typer Engine - Uses .NET SendKeys to type text
# Usage: powershell -File typer.ps1 <delayMs> <intervalMs> <textFilePath> [useEnglishSymbols]

param(
    [int]$delayMs = 3000,
    [int]$intervalMs = 15,
    [string]$textFile = "",
    [bool]$useEnglishSymbols = $false
)

Add-Type -AssemblyName System.Windows.Forms

# Read text from file (UTF-8)
$text = [System.IO.File]::ReadAllText($textFile, [System.Text.Encoding]::UTF8)

$code = @"
using System;
using System.Threading;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public class Typer {
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

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    const uint INPUT_KEYBOARD = 1;
    const uint KEYEVENTF_KEYUP = 2;
    const uint KEYEVENTF_UNICODE = 4;

    // Inject a character directly, bypassing the keyboard layout and IME,
    // so the Chinese IME cannot convert it into full-width punctuation.
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

    // ASCII symbols that a Chinese IME would turn into full-width variants
    public static bool IsAsciiSymbol(char c) {
        char[] symbols = new char[] {
            ',', '.', '?', '!', ':', ';', '\'', '"',
            '(', ')', '[', ']', '{', '}', '<', '>',
            '~', '@', '#', '%', '^', '&', '*', '-',
            '_', '=', '+', '\\', '|', '/', (char)96
        };
        return Array.IndexOf(symbols, c) >= 0;
    }

    public static void Run(int delayMs, int intervalMs, string text, bool englishSymbols) {
        // Countdown
        int totalDelay = delayMs;
        while (totalDelay > 0) {
            int step = Math.Min(1000, totalDelay);
            Thread.Sleep(step);
            totalDelay -= step;
            int secsLeft = (totalDelay + 999) / 1000;
            Console.WriteLine("COUNTDOWN:" + secsLeft);
        }

        Console.WriteLine("STARTED");

        int total = text.Length;
        int sent = 0;

        // Type each character directly (no pre-escape)
        // Handle special chars by sending the {} escaped form as a single SendWait call
        foreach (char c in text) {
            if (englishSymbols && IsAsciiSymbol(c)) {
                // Bypass the IME so the symbol stays half-width English
                SendUnicodeChar(c);
            } else {
                switch (c) {
                    case '+':
                    case '^':
                    case '%':
                    case '~':
                    case '(':
                    case ')':
                    case '{':
                    case '}':
                    case '[':
                    case ']':
                        // Special chars must be wrapped in {} and sent as a whole
                        SendKeys.SendWait("{" + c + "}");
                        break;
                    case '\n':
                        SendKeys.SendWait("{ENTER}");
                        break;
                    case '\t':
                        SendKeys.SendWait("{TAB}");
                        break;
                    case '\r':
                        // Skip \r
                        continue;
                    default:
                        SendKeys.SendWait(c.ToString());
                        break;
                }
            }

            sent++;
            if (intervalMs > 0) Thread.Sleep(intervalMs);
            if (sent % 10 == 0 || sent == total) {
                Console.WriteLine("PROGRESS:" + sent + "/" + total);
            }
        }
        Console.WriteLine("DONE:" + sent);
    }
}
"@

Add-Type -TypeDefinition $code -Language CSharp -ReferencedAssemblies System.Windows.Forms

[Typer]::Run($delayMs, $intervalMs, $text, $useEnglishSymbols)
