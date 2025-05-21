import * as vscode from 'vscode';
import { exec } from 'child_process';
import { SerialPort } from 'serialport';

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
  private _view?: vscode.WebviewView;

  constructor(private readonly context: vscode.ExtensionContext) {}

  async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
    };

    webviewView.webview.html = this.getHtml();

    // Send available COM ports to frontend
    const ports = await SerialPort.list();
    webviewView.webview.postMessage({
      command: 'populatePorts',
      ports: ports.map(p => p.path),
    });

    webviewView.webview.onDidReceiveMessage(async (message) => {
      const { port, board } = message;

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
      <head>
        <meta charset="UTF-8">
        <style>
          body {
            font-family: var(--vscode-font-family);
            font-size: 13px;
            padding: 12px;
            background-color: var(--vscode-sideBar-background);
            color: var(--vscode-foreground);
          }

          h3 {
            margin-top: 0;
            font-size: 16px;
            color: var(--vscode-sideBarTitle-foreground);
          }

          form, .section {
            margin-bottom: 24px;
          }

          label {
            display: block;
            margin-bottom: 6px;
          }

          input, select {
            width: 100%;
            padding: 6px;
            margin-bottom: 12px;
            border-radius: 4px;
            border: 1px solid var(--vscode-input-border);
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
          }

          button {
            display: block;
            width: 100%;
            padding: 10px 0;
            margin-top: 10px;
            margin-bottom: 10px;
            background-color: #5e2ca5;
            color: white;
            font-weight: bold;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            transition: background-color 0.2s ease-in-out;
          }

          button:hover {
            background-color: #7a3fc9;
          }

          hr {
            margin: 24px 0;
            border: none;
            border-top: 1px solid var(--vscode-editorGroup-border);
          }
        </style>
      </head>
      <body>
        <h3>ESP MicroPython Flasher</h3>

        <div class="section">
          <form id="firmwareForm">
            <label for="port">COM Port</label>
            <select id="port"></select>
            
            <label for="board">Board</label>
            <select id="board">
              <option value="esp32">ESP32</option>
              <option value="esp8266">ESP8266</option>
            </select>

            <button type="submit">Flash Firmware (.bin)</button>
          </form>
        </div>

        <hr />

        <div class="section">
          <form id="pythonForm">
            <label for="portPy">COM Port</label>
            <select id="portPy"></select>

            <button type="submit">Upload Active Python File as main.py</button>
          </form>

          <button id="runBtn">Run main.py</button>
        </div>

        <script>
          const vscode = acquireVsCodeApi();

          window.addEventListener('message', (event) => {
            const message = event.data;
            if (message.command === 'populatePorts') {
              const portSelects = [document.getElementById('port'), document.getElementById('portPy')];
              portSelects.forEach(select => {
                select.innerHTML = '';
                message.ports.forEach(port => {
                  const option = document.createElement('option');
                  option.value = port;
                  option.textContent = port;
                  select.appendChild(option);
                });
              });
            }
          });

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
              alert('Please select the COM Port before running.');
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
