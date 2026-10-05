# Auto Typer Engine - Uses .NET SendKeys to type text
# Usage: powershell -File typer.ps1 <delayMs> <intervalMs> <textFilePath>

param(
    [int]$delayMs = 3000,
    [int]$intervalMs = 15,
    [string]$textFile = ""
)

Add-Type -AssemblyName System.Windows.Forms

# Read text from file (UTF-8)
$text = [System.IO.File]::ReadAllText($textFile, [System.Text.Encoding]::UTF8)

$code = @"
using System;
using System.Threading;
using System.Windows.Forms;

public class Typer {
    public static void Run(int delayMs, int intervalMs, string text) {
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

[Typer]::Run($delayMs, $intervalMs, $text)
