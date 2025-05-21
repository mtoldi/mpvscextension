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
      enableScripts: true,
    };

    webviewView.webview.html = this.getHtml();

    webviewView.webview.onDidReceiveMessage(async (message) => {
      const { port, board } = message;

      console.log('Received message:', message);

      if (!port) {
        vscode.window.showErrorMessage('COM port is required.');
        return;
      }

      if (message.command === 'flashFirmware') {
        const fileUri = await vscode.window.showOpenDialog({
          filters: { 'BIN files': ['bin'] },
          canSelectMany: false,
        });

        if (!board || !fileUri) {
          vscode.window.showErrorMessage('Board and .bin file are required.');
          return;
        }

        const firmwarePath = fileUri[0].fsPath;
        const cmd = `python -u -m esptool --port ${port} --chip ${board} --baud 115200 write_flash --flash_mode keep --flash_size keep --erase-all 0x1000 "${firmwarePath}"`;

        vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Flashing firmware...',
            cancellable: false,
          },
          () =>
            new Promise<void>((resolve, reject) => {
              exec(cmd, (error, stdout, stderr) => {
                console.log('Command:', cmd);
                console.log('STDOUT:', stdout);
                console.log('STDERR:', stderr);

                if (error) {
                  vscode.window.showErrorMessage(`Firmware flashing failed: ${stderr || error.message}`);
                  reject(error);
                } else {
                  vscode.window.showInformationMessage('Firmware flashed successfully!');
                  resolve();
                }
              });
            })
        );
      } else if (message.command === 'uploadPython') {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor || activeEditor.document.languageId !== 'python') {
          vscode.window.showErrorMessage('No active Python file to upload.');
          return;
        }

        const filePath = activeEditor.document.fileName;
        const uploadCmd = `mpremote connect ${port} fs cp "${filePath}" :main.py`;

        vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Uploading Python file as main.py...',
            cancellable: false,
          },
          () =>
            new Promise<void>((resolve, reject) => {
              exec(uploadCmd, (uploadError, uploadStdout, uploadStderr) => {
                if (uploadError) {
                  vscode.window.showErrorMessage(`Upload failed: ${uploadStderr || uploadError.message}`);
                  reject(uploadError);
                  return;
                }

                vscode.window.showInformationMessage('Python file uploaded successfully as main.py!');
                resolve();
              });
            })
        );
      } else if (message.command === 'runPython') {
        const runCmd = `mpremote connect ${port} exec "import main"`;

        vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Running main.py...',
            cancellable: false,
          },
          () =>
            new Promise<void>((resolve, reject) => {
              exec(runCmd, (runError, runStdout, runStderr) => {
                console.log('Run STDOUT:', runStdout);
                console.log('Run STDERR:', runStderr);

                if (runError) {
                  vscode.window.showErrorMessage(`Running script failed: ${runStderr || runError.message}`);
                  reject(runError);
                } else {
                  vscode.window.showInformationMessage('Python script ran successfully!');
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
        
        <!-- Firmware flashing form -->
        <form id="firmwareForm">
          <label>COM Port: <input type="text" id="port" required /></label><br/>
          <label>Board: 
            <select id="board">
              <option value="esp32">ESP32</option>
              <option value="esp8266">ESP8266</option>
            </select>
          </label><br/>
          <button type="submit">Select .bin file & Flash</button>
        </form>
  
        <hr />
  
        <!-- Python file upload form -->
        <form id="pythonForm">
          <label>COM Port: <input type="text" id="portPy" required /></label><br/>
          <button type="submit">Upload Current Python File as main.py</button>
        </form>

        <button id="runBtn">Run main.py</button>
  
        <script>
          const vscode = acquireVsCodeApi();
  
          document.getElementById('firmwareForm').addEventListener('submit', (e) => {
            e.preventDefault();
            const port = document.getElementById('port').value;
            const board = document.getElementById('board').value;
            vscode.postMessage({ command: 'flashFirmware', port, board });
          });
  
          document.getElementById('pythonForm').addEventListener('submit', (e) => {
            e.preventDefault();
            const port = document.getElementById('portPy').value;
            vscode.postMessage({ command: 'uploadPython', port });
          });

          document.getElementById('runBtn').addEventListener('click', () => {
            const port = document.getElementById('portPy').value;
            if (!port) {
              alert('Please enter the COM Port before running.');
              return;
            }
            vscode.postMessage({ command: 'runPython', port });
          });
        </script>
      </body>
      </html>
    `;
  }
}
