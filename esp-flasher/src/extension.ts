import * as vscode from 'vscode';
import { exec } from 'child_process';
import { SerialPort } from 'serialport';


// flash from web novi dio

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as https from 'https';
import * as cheerio from 'cheerio';
import Fuse from 'fuse.js';

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

  private outputChannel = vscode.window.createOutputChannel("ESP Output");


  constructor(private readonly context: vscode.ExtensionContext) {
  }

  // flash from web novi dio

private async handleFlashFromWeb(firmwareUrl: string, port: string, chip: string) {
  const tmpPath = path.join(os.tmpdir(), path.basename(firmwareUrl));
  await this.downloadFile(firmwareUrl, tmpPath);

  const command = `python -u -m esptool --port ${port} --chip ${chip} --baud 115200 write_flash --flash_mode keep --flash_size keep --erase-all 0x1000 "${tmpPath}"`;

  this.outputChannel.appendLine(`📤 Executing: ${command}`);

  vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Flashing firmware...',
      cancellable: false,
    },
    () => new Promise<void>((resolve, reject) => {
      exec(command, (err, stdout, stderr) => {
        this.outputChannel.appendLine('[stdout]');
        this.outputChannel.appendLine(stdout);
        if (stderr) {
          this.outputChannel.appendLine('[stderr]');
          this.outputChannel.appendLine(stderr);
        }

        if (err) {
          vscode.window.showErrorMessage(`Flash failed: ${stderr || err.message}`);
          reject(err);
        } else {
          vscode.window.showInformationMessage('Flash successful!');
          resolve();
          this._view?.webview.postMessage({ command: 'triggerListFiles', port });
        }
      });
    })
  );
}


private async fetchFirmwareList(): Promise<{ name: string, url: string }[]> {
  const baseUrl = 'https://micropython.org';
  const boardSlugs = [
    'ESP32_GENERIC',
  ];

  const allBinaries: { name: string, url: string }[] = [];

  const fetchPromises = boardSlugs.map(slug => {
    return new Promise<void>((resolve) => {
      const fullUrl = `${baseUrl}/download/${slug}/`;
      this.outputChannel.appendLine(`🔍 Scanning: ${fullUrl}`);

      https.get(fullUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          const $ = cheerio.load(data);
          let count = 0;

          $('a').each((_, el) => {
            const href = $(el).attr('href');
            if (href && href.endsWith('.bin') && href.includes('/resources/firmware/')) {
              const binUrl = href.startsWith('http') ? href : `${baseUrl}${href}`;
              allBinaries.push({ name: path.basename(binUrl), url: binUrl });
              count++;
            }
          });

          this.outputChannel.appendLine(`✅ Found ${count} .bin files at ${slug}`);
          resolve();
        });
      }).on('error', err => {
        this.outputChannel.appendLine(`⚠️ Failed to fetch ${fullUrl}: ${err.message}`);
        resolve();
      });
    });
  });

  await Promise.all(fetchPromises);
  this.outputChannel.appendLine(`📦 Total firmware binaries found: ${allBinaries.length}`);
  return allBinaries;
}


private async downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, response => {
      response.pipe(file);
      file.on('finish', () => {
  file.close((err) => {
    if (err) {
      reject(err);
    } else {
      resolve();
    }
  });
});

    }).on('error', err => {
      fs.unlink(dest, () => reject(err));
    });
  });
}

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

    // ✅ Automatically trigger file listing for the first available port
    if (ports.length > 0) {
      webviewView.webview.postMessage({
        command: 'triggerListFiles',
        port: ports[0].path,
      });
    }

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
      
        if (!fileUri) {
          vscode.window.showErrorMessage('No firmware file selected.');
          return;
        }
      
        const firmwarePath = fileUri[0].fsPath;
      
        // Remove '--chip' argument to make it generic
        const cmd = `python -u -m esptool --port ${message.port} --baud 115200 write_flash --flash_mode keep --flash_size keep --erase-all 0x1000 "${firmwarePath}"`;


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
                this._view?.webview.postMessage({ command: 'triggerListFiles', port: message.port });
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

      else if (message.command === 'getFirmwareOptions') {
        const firmwareList = await this.fetchFirmwareList();
        const fuse = new Fuse(firmwareList, { keys: ['name'], threshold: 0.4 });
        const matches = fuse.search(message.board || '');
      
        const filtered = matches.slice(0, 15).map(m => m.item);
        this._view?.webview.postMessage({ command: 'setFirmwareOptions', options: filtered });
      }


      else if (message.command === 'flashFromWeb') {
        const { firmwareUrl, port, chip } = message;
      
        if (!firmwareUrl || !port || !chip) {
          vscode.window.showErrorMessage('Firmware URL, port, and chip are required for flashing.');
          return;
        }
      
        await this.handleFlashFromWeb(firmwareUrl, port, chip);
      }


      else if (message.command === 'uploadPythonAsIs') {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor || activeEditor.document.languageId !== 'python') {
          vscode.window.showErrorMessage('No active Python file to upload.');
          return;
        }
      
        const filePath = activeEditor.document.fileName;
        const fileName = filePath.split(/[/\\]/).pop(); // Extract filename only
        const uploadCmd = `mpremote connect ${message.port} fs cp "${filePath}" :"${fileName}"`;
      
        vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Uploading ${fileName} to device...`,
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
              
                vscode.window.showInformationMessage(`${fileName} uploaded successfully!`);
                resolve();
                this._view?.webview.postMessage({ command: 'triggerListFiles', port: message.port });

              });
            })
        );
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
                  // this.outputChannel.clear();
                  this.outputChannel.appendLine(`>>> Running ${filename} on ${port}\n`);
                  this.outputChannel.appendLine(runStdout);
                  if (runStderr) this.outputChannel.appendLine(`\n[stderr]\n${runStderr}`);
                  this.outputChannel.show(true);


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
    h4 {
      font-size: 15px;
      margin-bottom: 6px;
      cursor: pointer;
    }
    .section {
      margin-bottom: 24px;
    }
    .section-content {
      margin-top: 8px;
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
      background-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      font-weight: bold;
      border: none;
      border-radius: 6px;
      cursor: pointer;
    }
    button:hover {
      background-color: var(--vscode-button-hoverBackground);
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
    .toggleable > .section-content {
      display: none;
    }
    .toggleable.open > .section-content {
      display: block;
    }
  </style>
</head>
<body>

  <!-- COM Port Dropdown (Shared) -->
  <label for="port">COM port Selection</label>
  <select id="port"></select>

  <!-- Flash Firmware Section -->
  <div class="section toggleable" id="flashSection">
    <h4 onclick="toggleSection('flashSection')">Flash Firmware</h4>
    <div class="section-content">

      <label for="firmwareQuery">Search Firmware (e.g. esp32, s3, rp2)</label>
      <input type="text" id="firmwareQuery" placeholder="Type board name...">

      <label for="firmwareSelect">Top 5 Matches</label>
      <select id="firmwareSelect" size="5"></select>

      <button id="flashFromWebBtn">Download + Flash from Web</button>

      <button id="flashLocalBtn">Flash .bin File from PC</button>

    </div>
  </div>

  <!-- Upload & Manage Section -->
  <div class="section toggleable" id="uploadSection">
    <h4 onclick="toggleSection('uploadSection')">Upload & Manage Python Scripts</h4>
    <div class="section-content">

      <button id="uploadPythonBtn">Upload Active Python File as main.py</button>
      <button id="uploadAsIsBtn">Upload Active Python File</button>

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
  </div>

      <script>
        const vscode = acquireVsCodeApi();


        function toggleSection(id) {
          const section = document.getElementById(id);
          section.classList.toggle("open");
        }

        // === Init events ===
        window.addEventListener('load', () => {
          const board = document.getElementById('firmwareQuery').value;
          const port = document.getElementById('port').value;
          vscode.postMessage({ command: 'getFirmwareOptions', board, port });
        });

        document.getElementById('firmwareQuery').addEventListener('input', (e) => {
          const board = e.target.value;
          const port = document.getElementById('port').value;
          vscode.postMessage({ command: 'getFirmwareOptions', board, port });
        });

        // === Flash from Web ===
        document.getElementById('flashFromWebBtn').addEventListener('click', () => {
          const firmwareUrl = document.getElementById('firmwareSelect').value;
          const chip = document.getElementById('board').value;
          const port = document.getElementById('port').value;

          if (!firmwareUrl || !port || !chip) {
            alert('Please select firmware, port, and board before flashing.');
            return;
          }

          vscode.postMessage({
            command: 'flashFromWeb',
            firmwareUrl,
            port,
            chip
          });
        });

        // === Message listener ===
        window.addEventListener('message', (event) => {
          const message = event.data;

          if (message.command === 'setFirmwareOptions') {
            const select = document.getElementById('firmwareSelect');
            select.innerHTML = '';
            message.options.forEach(opt => {
              const option = document.createElement('option');
              option.value = opt.url;
              option.textContent = opt.name;
              select.appendChild(option);
            });
          }

          if (message.command === 'populatePorts') {
            const select = document.getElementById('port');
            select.innerHTML = '';
            message.ports.forEach(port => {
              const option = document.createElement('option');
              option.value = port;
              option.textContent = port;
              select.appendChild(option);
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

        // === Upload / Flash / Run / Delete ===
        document.getElementById('flashLocalBtn').addEventListener('click', () => {
          const port = document.getElementById('port').value;
          if (!port) return alert('Please select the COM Port before flashing.');
          vscode.postMessage({ command: 'flashFirmware', port });
        });

        document.getElementById('uploadPythonBtn').addEventListener('click', () => {
          const port = document.getElementById('port').value;
          if (!port) return alert('Please select the COM Port before uploading.');
          vscode.postMessage({ command: 'uploadPython', port });
        });

        document.getElementById('uploadAsIsBtn').addEventListener('click', () => {
          const port = document.getElementById('port').value;
          if (!port) return alert('Please select the COM Port before uploading.');
          vscode.postMessage({ command: 'uploadPythonAsIs', port });
        });

        document.getElementById('listFilesBtn').addEventListener('click', () => {
          const port = document.getElementById('port').value;
          if (!port) return alert('Please select the COM Port before listing files.');
          vscode.postMessage({ command: 'listFiles', port });
        });

        document.getElementById('refreshBtn').addEventListener('click', () => {
          const port = document.getElementById('port').value;
          if (!port) return alert('Please select the COM Port before refreshing files.');
          vscode.postMessage({ command: 'listFiles', port });
        });

        document.getElementById('deleteFileBtn').addEventListener('click', () => {
          const port = document.getElementById('port').value;
          const filename = document.getElementById('fileSelect').value;
          if (!port) return alert('Please select the COM Port before deleting a file.');
          if (!filename) return alert('No file selected to delete.');
          vscode.postMessage({ command: 'deleteFile', port, filename });
        });

        document.getElementById('runFileBtn').addEventListener('click', () => {
          const port = document.getElementById('port').value;
          const filename = document.getElementById('fileSelect').value;
          if (!port) return alert('Please select the COM Port before running a file.');
          if (!filename) return alert('No file selected to run.');
          vscode.postMessage({ command: 'runPythonFile', port, filename });
        });

      </script>
    </body>
    </html>
  `;
}
}
