import * as vscode from 'vscode';
import { exec } from 'child_process';

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      'espFlasherWebview',
      new EspFlasherViewProvider(context)
    )
  );
}

export function deactivate() {}

class EspFlasherViewProvider implements vscode.WebviewViewProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    webviewView.webview.options = {
      enableScripts: true
    };

    webviewView.webview.html = this.getHtml();

    webviewView.webview.onDidReceiveMessage(async message => {
      if (message.command === 'flash') {
        const { port, board } = message;
        const fileUri = await vscode.window.showOpenDialog({
          filters: { 'BIN files': ['bin'] },
          canSelectMany: false
        });

        if (!port || !board || !fileUri) {
          vscode.window.showErrorMessage('All inputs are required.');
          return;
        }

        const firmwarePath = fileUri[0].fsPath;
        const pythonCmd = 'python'; // or 'python3'

        const cmd = `${pythonCmd} -u -m esptool --port ${port} --chip ${board} --baud 115200 write_flash --flash_mode keep --flash_size keep --erase-all 0x1000 "${firmwarePath}"`;

        vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Flashing firmware...',
            cancellable: false
          },
          () =>
            new Promise<void>((resolve, reject) => {
              exec(cmd, (error, stdout, stderr) => {
                if (error) {
                  vscode.window.showErrorMessage(`Flashing failed: ${stderr || error.message}`);
                  reject(error);
                } else {
                  vscode.window.showInformationMessage('Firmware flashed successfully!');
                  resolve();
                }
              });
            })
        );
      }
    });
  }

  private getHtml(): string {
    return `
      <!DOCTYPE html>
      <html lang="en">
      <body>
        <h3>ESP MicroPython Flasher</h3>
        <form id="flashForm">
          <label>COM Port: <input type="text" id="port" required /></label><br/>
          <label>Board: 
            <select id="board">
              <option value="esp32">ESP32</option>
              <option value="esp8266">ESP8266</option>
            </select>
          </label><br/>
          <button type="submit">Select .bin file & Flash</button>
        </form>
        <script>
          const vscode = acquireVsCodeApi();
          document.getElementById('flashForm').addEventListener('submit', (e) => {
            e.preventDefault();
            const port = document.getElementById('port').value;
            const board = document.getElementById('board').value;
            vscode.postMessage({ command: 'flash', port, board });
          });
        </script>
      </body>
      </html>
    `;
  }
}
