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

      if (!port && message.command !== 'flashFirmware') {
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
      } 
      else if (message.command === 'uploadPython') {
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
      } 
      else if (message.command === 'listFiles') {
        const listCmd = `mpremote connect ${port} exec "import os; print(os.listdir())"`;

        exec(listCmd, (err, stdout, stderr) => {
          if (err) {
            vscode.window.showErrorMessage(`Failed to list files: ${stderr || err.message}`);
            return;
          }
        
          // Clean up output to parse list
          try {
            const match = stdout.match(/\[.*?\]/s);
            const files = match ? JSON.parse(match[0].replace(/'/g, '"')) : [];
            this._view?.webview.postMessage({ command: 'displayFiles', files });
          } catch (e) {
            vscode.window.showErrorMessage('Failed to parse file list.');
          }
        });
      }
      else if (message.command === 'runPythonFile') {
        const { filename } = message;

        if (!filename) {
          vscode.window.showErrorMessage('Filename is required to run the script.');
          return;
        }
        
        // Remove .py extension if present
        const moduleName = filename.endsWith('.py') ? filename.slice(0, -3) : filename;

        const runCmd = `mpremote connect ${port} exec "import ${moduleName}"`;

        vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Running ${filename}...`,
            cancellable: false,
          },
          () =>
            new Promise<void>((resolve, reject) => {
              exec(runCmd, (runError, runStdout, runStderr) => {
                console.log(`Run ${filename} STDOUT:`, runStdout);
                console.log(`Run ${filename} STDERR:`, runStderr);

                if (runError) {
                  vscode.window.showErrorMessage(`Running script failed: ${runStderr || runError.message}`);
                  reject(runError);
                } else {
                  vscode.window.showInformationMessage(`${filename} ran successfully!`);
                  resolve();
                }
              });
            })
        );
      }
      else if (message.command === 'deleteFile') {
        const delCmd = `mpremote connect ${port} exec "import os; os.remove('${message.filename}')"`;

        exec(delCmd, (err, stdout, stderr) => {
          if (err) {
            vscode.window.showErrorMessage(`Failed to delete file: ${stderr || err.message}`);
          } else {
            vscode.window.showInformationMessage(`Deleted ${message.filename} successfully.`);
            // Re-fetch file list
            this._view?.webview.postMessage({ command: 'triggerListFiles', port });
          }
        });
      }  
    });
  }

  private getHtml(): string {
    return `
      <!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
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

    .buttons-row {
      display: flex;
      gap: 10px;
      margin-bottom: 12px;
    }

    .buttons-row button {
      flex: 1;
      margin-top: 0;
    }
  </style>
</head>
<body>
  <h3>ESP MicroPython Flasher</h3>

  <div class="section">
    <h4>Flash Firmware</h4>
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
    <h4>Upload & Manage Python Scripts</h4>

    <label for="portDevice">COM Port</label>
    <select id="portDevice"></select>

    <button id="uploadPythonBtn">Upload Active Python File as main.py</button>

    <div class="buttons-row">
      <button id="listFilesBtn">List Files</button>
      <button id="refreshBtn">Refresh Files</button>
    </div>

    <label for="fileSelect">Files on Device</label>
    <select id="fileSelect" size="6" style="width: 100%;"></select>

    <div class="buttons-row">
      <button id="runFileBtn">Run Selected File</button>
      <button id="deleteFileBtn">Delete Selected File</button>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    window.addEventListener('message', (event) => {
      const message = event.data;

      if (message.command === 'populatePorts') {
        ['port', 'portDevice'].forEach(id => {
          const select = document.getElementById(id);
          select.innerHTML = '';
          message.ports.forEach(port => {
            const option = document.createElement('option');
            option.value = port;
            option.textContent = port;
            select.appendChild(option);
          });
        });
      }

      if (message.command === 'displayFiles') {
        const fileSelect = document.getElementById('fileSelect');
        fileSelect.innerHTML = '';
        message.files.forEach(file => {
          const option = document.createElement('option');
          option.value = file;
          option.textContent = file;
          fileSelect.appendChild(option);
        });
      }

      if (message.command === 'triggerListFiles') {
        vscode.postMessage({ command: 'listFiles', port: message.port });
      }
    });

    // Firmware flash form
    document.getElementById('firmwareForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const port = document.getElementById('port').value;
      const board = document.getElementById('board').value;
      vscode.postMessage({ command: 'flashFirmware', port, board });
    });

    // Upload Python file
    document.getElementById('uploadPythonBtn').addEventListener('click', () => {
      const port = document.getElementById('portDevice').value;
      if (!port) {
        alert('Please select the COM Port before uploading.');
        return;
      }
      vscode.postMessage({ command: 'uploadPython', port });
    });

    // List files
    document.getElementById('listFilesBtn').addEventListener('click', () => {
      const port = document.getElementById('portDevice').value;
      if (!port) {
        alert('Please select the COM Port before listing files.');
        return;
      }
      vscode.postMessage({ command: 'listFiles', port });
    });

    // Refresh files (same as list)
    document.getElementById('refreshBtn').addEventListener('click', () => {
      const port = document.getElementById('portDevice').value;
      if (!port) {
        alert('Please select the COM Port before refreshing files.');
        return;
      }
      vscode.postMessage({ command: 'listFiles', port });
    });

    // Delete selected file
    document.getElementById('deleteFileBtn').addEventListener('click', () => {
      const port = document.getElementById('portDevice').value;
      const filename = document.getElementById('fileSelect').value;
      if (!port) {
        alert('Please select the COM Port before deleting a file.');
        return;
      }
      if (!filename) {
        alert('No file selected to delete.');
        return;
      }
      vscode.postMessage({ command: 'deleteFile', port, filename });
    });

    // Run selected file
    document.getElementById('runFileBtn').addEventListener('click', () => {
      const port = document.getElementById('portDevice').value;
      const filename = document.getElementById('fileSelect').value;
      if (!port) {
        alert('Please select the COM Port before running a file.');
        return;
      }
      if (!filename) {
        alert('No file selected to run.');
        return;
      }
      vscode.postMessage({ command: 'runPythonFile', port, filename });
    });
  </script>
</body>
</html>
    `;
  }
}
