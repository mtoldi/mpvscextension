// VS Code API for interacting with the editor, showing messages, progress, etc.
import * as vscode from 'vscode';

// Allows executing terminal/CLI commands like `mpremote` and `esptool`
import { exec } from 'child_process';

// Used to list available serial ports for device connection
import { SerialPort } from 'serialport';

// Node.js core modules for filesystem, paths, OS temp directory, HTTPS requests
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as https from 'https';

// Cheerio is a fast, flexible jQuery-like HTML parser for scraping the Micropython firmware page
import * as cheerio from 'cheerio';

// Fuse.js provides fuzzy searching to find the best matching firmware options based on user input
import Fuse from 'fuse.js';

// Called when the extension is activated (e.g. when VS Code starts or the user opens the extension panel)
export function activate(context: vscode.ExtensionContext) {
  // Register the Webview View Provider which supplies the HTML UI and handles backend logic
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      'espFlasherWebview',                   // This must match the ID used in `package.json`
      new EspFlasherViewProvider(context)    // The class that provides the Webview functionality
    )
  );
}

// Called when the extension is deactivated (e.g. when VS Code shuts down or the extension is disabled)
// You can clean up resources here if needed (nothing to clean up in this case)
export function deactivate() {}

function execCommand(command: string): Promise<void> {
  return new Promise((resolve, reject) => {
    exec(command, (err, stdout, stderr) => {
      if (stdout) console.log(stdout);
      if (stderr) console.error(stderr);

      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}



class EspFlasherViewProvider implements vscode.WebviewViewProvider {

  private _view?: vscode.WebviewView;

  private outputChannel = vscode.window.createOutputChannel("ESP Output");


  constructor(private readonly context: vscode.ExtensionContext) {
  }

/**
 * Downloads a firmware binary from the web and flashes it to the selected device.
 * 
 * @param firmwareUrl - The full URL to the .bin firmware file.
 * @param port - The serial port where the board is connected (e.g., COM3, /dev/ttyUSB0).
 */

private async handleFlashFromWeb(firmwareUrl: string, port: string) {
  // Create a temporary path where the firmware file will be downloaded
  const tmpPath = path.join(os.tmpdir(), path.basename(firmwareUrl));

  // Download the .bin firmware file to the temporary path
  await this.downloadFile(firmwareUrl, tmpPath);

  // Construct the esptool command to flash the firmware to the device
  const command = `python -u -m esptool --port ${port} --baud 115200 write_flash --flash_mode keep --flash_size keep --erase-all 0x1000 "${tmpPath}"`;

  // Log the command being executed to the extension's output channel
  this.outputChannel.appendLine(`📤 Executing: ${command}`);

  // Show a progress notification in VS Code while flashing is in progress
  vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Flashing firmware...',
      cancellable: false,
    },
    () =>
      new Promise<void>((resolve, reject) => {
        // Execute the flashing command
        exec(command, (err, stdout, stderr) => {
          // Log stdout and stderr to output channel
          this.outputChannel.appendLine('[stdout]');
          this.outputChannel.appendLine(stdout);
          if (stderr) {
            this.outputChannel.appendLine('[stderr]');
            this.outputChannel.appendLine(stderr);
          }

          // Show success or error message to the user
          if (err) {
            vscode.window.showErrorMessage(`Flash failed: ${stderr || err.message}`);
            reject(err);
          } else {
            vscode.window.showInformationMessage('Flash successful!');
            resolve();

            // Ask frontend to re-list files (in case the new firmware changes them)
            this._view?.webview.postMessage({ command: 'triggerListFiles', port });
          }
        });
      })
  );
}

/**
 * Fetches a list of available MicroPython firmware binaries (.bin files)
 * from the official micropython.org firmware download page for supported boards.
 *
 * Currently limited to 'ESP32_GENERIC' slug but can be extended easily.
 * 
 * @returns A Promise that resolves to an array of firmware file names and their download URLs.
 */
private async fetchFirmwareList(): Promise<{ name: string, url: string }[]> {
  const baseUrl = 'https://micropython.org';

  // List of board slugs to search firmware for. This can be extended for more boards.
  const boardSlugs = [
    'ESP32_GENERIC',
  ];

  const allBinaries: { name: string, url: string }[] = [];

  // Fetch and parse firmware listings for each board
  const fetchPromises = boardSlugs.map(slug => {
    return new Promise<void>((resolve) => {
      const fullUrl = `${baseUrl}/download/${slug}/`;

      // Log which URL is being scanned
      this.outputChannel.appendLine(`🔍 Scanning: ${fullUrl}`);

      // Perform HTTPS GET request to fetch HTML content of the firmware listing page
      https.get(fullUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
        let data = '';

        // Accumulate response data chunks
        res.on('data', chunk => data += chunk);

        // Once the whole page is loaded
        res.on('end', () => {
          const $ = cheerio.load(data);  // Use Cheerio to parse HTML
          let count = 0;

          // Find all <a> tags on the page and extract firmware links
          $('a').each((_, el) => {
            const href = $(el).attr('href');

            // We're only interested in .bin firmware files from the /resources/firmware/ path
            if (href && href.endsWith('.bin') && href.includes('/resources/firmware/')) {
              // Resolve relative URL to full URL
              const binUrl = href.startsWith('http') ? href : `${baseUrl}${href}`;

              allBinaries.push({
                name: path.basename(binUrl), // Extract just the file name
                url: binUrl
              });

              count++;
            }
          });

          this.outputChannel.appendLine(`✅ Found ${count} .bin files at ${slug}`);
          resolve();
        });
      }).on('error', err => {
        // Handle request failure gracefully and log it
        this.outputChannel.appendLine(`⚠️ Failed to fetch ${fullUrl}: ${err.message}`);
        resolve();
      });
    });
  });

  // Wait for all fetch operations to complete
  await Promise.all(fetchPromises);

  this.outputChannel.appendLine(`📦 Total firmware binaries found: ${allBinaries.length}`);
  return allBinaries;
}

/**
 * Downloads a file from a given HTTPS URL and saves it to a local destination.
 * Used to fetch firmware binaries before flashing.
 *
 * @param url - The URL of the file to download
 * @param dest - The local path to save the downloaded file
 * @returns A Promise that resolves when the file has been successfully downloaded
 */
private async downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Create a writable stream to the destination file
    const file = fs.createWriteStream(dest);

    // Start downloading the file via HTTPS
    https.get(url, response => {
      // Pipe the incoming data directly into the file stream
      response.pipe(file);

      // Once the file stream finishes writing
      file.on('finish', () => {
        // Close the stream to ensure all data is flushed
        file.close((err) => {
          if (err) {
            reject(err);  // Reject if there was an error closing the file
          } else {
            resolve();    // Success!
          }
        });
      });

    }).on('error', err => {
      // On download error, delete the partially written file (if any) and reject
      fs.unlink(dest, () => reject(err));
    });
  });
}


/**
 * Called when the Webview view is resolved and ready to be displayed.
 * This is where we set up the Webview HTML, send initial data, and hook up message listeners.
 */
async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
  // Store the view reference so we can post messages to it later
  this._view = webviewView;

  // Enable JavaScript execution in the Webview
  webviewView.webview.options = {
    enableScripts: true,
  };

  // Load and assign the Webview HTML content
  webviewView.webview.html = this.getHtml();

  // Get a list of available serial ports (e.g. COM3, /dev/ttyUSB0)
  const ports = await SerialPort.list();

  // Send the available port list to the frontend dropdown
  webviewView.webview.postMessage({
    command: 'populatePorts',
    ports: ports.map(p => p.path),
  });

  // If ports are available, automatically list files on the first port
  if (ports.length > 0) {
    webviewView.webview.postMessage({
      command: 'triggerListFiles',
      port: ports[0].path,
    });
  }

  // Handle incoming messages from the Webview (frontend)
  webviewView.webview.onDidReceiveMessage(async (message) => {
    const { port, board } = message;

    // For most commands, port is required (except for local .bin flash)
    if (!port && message.command !== 'flashFirmware') {
      vscode.window.showErrorMessage('COM port is required.');
      return;
    }

  // Handle flashing from a local .bin file selected by the user
  if (message.command === 'flashFirmware') {
    // Ask user to choose a .bin file from disk
    const fileUri = await vscode.window.showOpenDialog({
      filters: { 'BIN files': ['bin'] },
      canSelectMany: false,
    });
  
    if (!fileUri) {
      vscode.window.showErrorMessage('No firmware file selected.');
      return;
    }
  
    const firmwarePath = fileUri[0].fsPath;
  
    // Construct esptool.py command (no --chip arg for generic compatibility)
    const cmd = `python -u -m esptool --port ${message.port} --baud 115200 write_flash --flash_mode keep --flash_size keep --erase-all 0x1000 "${firmwarePath}"`;
  
    // Show progress notification during the flashing process
    vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Flashing firmware...',
        cancellable: false,
      },
      () =>
        new Promise<void>((resolve, reject) => {
          // Run the flashing command
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

  // Handle uploading the currently active Python file as 'main.py' to the device
  else if (message.command === 'uploadPython') {
    const activeEditor = vscode.window.activeTextEditor;

    // Make sure there's a Python file open and active in the editor
    if (!activeEditor || activeEditor.document.languageId !== 'python') {
      vscode.window.showErrorMessage('No active Python file to upload.');
      return;
    }

    const filePath = activeEditor.document.fileName;

    // Upload the file to the device as 'main.py' using mpremote
    const uploadCmd = `mpremote connect ${port} fs cp "${filePath}" :main.py`;

    vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Uploading Python file as main.py...',
        cancellable: false,
      },
      () =>
        new Promise<void>((resolve, reject) => {
          // Execute the upload command
          exec(uploadCmd, (uploadError, uploadStdout, uploadStderr) => {
            if (uploadError) {
              vscode.window.showErrorMessage(`Upload failed: ${uploadStderr || uploadError.message}`);
              reject(uploadError);
              return;
            }

            vscode.window.showInformationMessage('Python file uploaded successfully as main.py!');
            resolve();

            // Ask the Webview to refresh the list of files on the device
            this._view?.webview.postMessage({ command: 'triggerListFiles', port: message.port });
          });
        })
    );
  }

  // Handle listing files stored on the device using mpremote + os.listdir()
  else if (message.command === 'listFiles') {
    // Python one-liner that prints all files in the current directory
    const listCmd = `mpremote connect ${port} exec "import os; print(os.listdir())"`;

    // Execute the command
    exec(listCmd, (err, stdout, stderr) => {
      if (err) {
        vscode.window.showErrorMessage(`Failed to list files: ${stderr || err.message}`);
        return;
      }

      // Try to extract the list from stdout
      try {
        const match = stdout.match(/\[[\s\S]*?\]/); // [\s\S] matches any character including newlines
        const files = match ? JSON.parse(match[0].replace(/'/g, '"')) : [];

        // Send file list to the frontend to display in the UI
        this._view?.webview.postMessage({ command: 'displayFiles', files });
      } catch (e) {
        vscode.window.showErrorMessage('Failed to parse file list.');
      }
    });
  }

  // Handle firmware search based on user query (e.g. "esp32", "s3", etc.)
  else if (message.command === 'getFirmwareOptions') {
    // Fetch the full list of firmware binaries from micropython.org
    const firmwareList = await this.fetchFirmwareList();

    // Set up fuzzy search to match user input to firmware filenames
    const fuse = new Fuse(firmwareList, {
      keys: ['name'],         // Search based on firmware file name
      threshold: 0.4          // Fuzziness sensitivity (lower = stricter match)
    });

    // Search using the board name entered in the frontend
    const matches = fuse.search(message.board || '');

    // Limit to top 15 matches to avoid flooding the UI
    const filtered = matches.slice(0, 15).map(m => m.item);

    // Send the filtered list back to the Webview to populate the dropdown
    this._view?.webview.postMessage({
      command: 'setFirmwareOptions',
      options: filtered
    });
  }

  // Handle flashing firmware directly from a URL selected in the Webview
  else if (message.command === 'flashFromWeb') {
    const { firmwareUrl, port } = message;

    // Check that both URL and port were provided
    if (!firmwareUrl || !port) {
      vscode.window.showErrorMessage('Firmware URL and port are required for flashing.');
      return;
    }

    // Download the firmware and flash it using esptool
    await this.handleFlashFromWeb(firmwareUrl, port);
  }

  // Handle opening a file that exists on the device and showing it in the VS Code editor
  else if (message.command === 'openFileFromDevice') {
    const { port, filename } = message;

    // Build a temporary local path to download the file into
    const tempDir = path.join(os.tmpdir(), 'esp-temp');
    const localPath = path.join(tempDir, filename);

    try {
      // Ensure the temp directory exists
      await fs.promises.mkdir(tempDir, { recursive: true });

      // Build the mpremote command to copy the file from the device
      const cmd = `mpremote connect ${port} fs cp :"${filename}" "${localPath}"`;

      this.outputChannel.appendLine(`📥 Downloading ${filename} from device...`);

      // Run the command to copy the file from the device
      exec(cmd, async (err, stdout, stderr) => {
        if (err) {
          vscode.window.showErrorMessage(`Failed to download file: ${stderr || err.message}`);
          return;
        }

        // Open the downloaded file in a new VS Code editor tab
        const doc = await vscode.workspace.openTextDocument(localPath);
        await vscode.window.showTextDocument(doc, { preview: false });

        vscode.window.showInformationMessage(`Opened ${filename} from device.`);
      });

    } catch (err) {
      // Handle errors from mkdir or anything before exec
      const message = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Failed to prepare file for editing: ${message}`);
    }
  }

  // Handle uploading the currently active Python file as-is (preserves original filename)
  else if (message.command === 'uploadPythonAsIs') {
    const activeEditor = vscode.window.activeTextEditor;

    // Ensure there's an active Python file
    if (!activeEditor || activeEditor.document.languageId !== 'python') {
      vscode.window.showErrorMessage('No active Python file to upload.');
      return;
    }

    // Get full file path and extract just the filename
    const filePath = activeEditor.document.fileName;
    const fileName = filePath.split(/[/\\]/).pop(); // Cross-platform basename

    // Build mpremote command to copy the file using its original name
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

            // Refresh file list in Webview
            this._view?.webview.postMessage({ command: 'triggerListFiles', port: message.port });
          });
        })
    );
  }

  // Handle running a selected Python file from the device
  else if (message.command === 'runPythonFile') {
    const { filename } = message;

    // Ensure a filename was provided
    if (!filename) {
      vscode.window.showErrorMessage('Filename is required to run the script.');
      return;
    }

    // Strip the .py extension if present to get the module name
    // const moduleName = filename.endsWith('.py') ? filename.slice(0, -3) : filename;
    const moduleName = filename
      .replace(/\.py$/, '')       // remove .py
      .replace(/-/g, '_');        // replace dashes with underscores


    // Build the mpremote command to import the file on the device
    const runCmd = `mpremote connect ${port} exec "import ${moduleName}"`;

    vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Running ${filename}...`,
        cancellable: false,
      },
      () =>
        new Promise<void>((resolve, reject) => {
          // Execute the command to run the script
          exec(runCmd, (runError, runStdout, runStderr) => {
            // Output everything to the ESP Output channel
            this.outputChannel.appendLine(`>>> Running ${filename} on ${port}\n`);
            this.outputChannel.appendLine(runStdout);
            if (runStderr) this.outputChannel.appendLine(`\n[stderr]\n${runStderr}`);
            this.outputChannel.show(true); // Bring the Output tab to front

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

  // Handle request to get a fresh list of available COM ports
  else if (message.command === 'getPorts') {
    // Query available serial ports using serialport library
    const ports = await SerialPort.list();

    // Send the port list to the Webview so the dropdown can update
    this._view?.webview.postMessage({
      command: 'populatePorts',
      ports: ports.map(p => p.path),
    });
  }

  // Handle uploading a .py file from disk (not necessarily open in the editor)
  else if (message.command === 'uploadPythonFromPc') {
    // Ask the user to select a Python file from their file system
    const fileUri = await vscode.window.showOpenDialog({
      filters: { 'Python Files': ['py'] },
      canSelectMany: false,
    });
  
    // If user canceled or selected nothing
    if (!fileUri || fileUri.length === 0) {
      vscode.window.showErrorMessage('No file selected.');
      return;
    }
  
    // Extract path and filename
    const filePath = fileUri[0].fsPath;
    const fileName = path.basename(filePath);
  
    // Build command to upload selected file using mpremote
    const uploadCmd = `mpremote connect ${message.port} fs cp "${filePath}" :"${fileName}"`;
  
    vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Uploading ${fileName} from PC...`,
        cancellable: false,
      },
      () =>
        new Promise<void>((resolve, reject) => {
          // Execute the upload
          exec(uploadCmd, (err, stdout, stderr) => {
            if (err) {
              vscode.window.showErrorMessage(`Upload failed: ${stderr || err.message}`);
              reject(err);
            } else {
              vscode.window.showInformationMessage(`${fileName} uploaded successfully!`);
              resolve();
            
              // Refresh file list after upload
              this._view?.webview.postMessage({ command: 'triggerListFiles', port: message.port });
            }
          });
        })
    );
  }

  // Soldered Modules
  else if (message.command === 'fetchModule') {
    const { sensor, port } = message;
    if (!sensor || !port) {
      vscode.window.showErrorMessage('Module name and port are required.');
      return;
    }

    const apiUrl = `https://api.github.com/repos/SolderedElectronics/Soldered-MicroPython-Modules/contents/Sensors/${sensor}`;

    https.get(apiUrl, { headers: { 'User-Agent': 'vscode-extension' } }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', async () => {
        try {
          const files = JSON.parse(data);
          const pyFiles = files.filter((f: any) => f.name.endsWith('.py'));

          if (pyFiles.length === 0) {
            vscode.window.showWarningMessage(`No Python files found for module "${sensor}"`);
            return;
          }

          for (const file of pyFiles) {
            const originalName = file.name;                         // e.g. 'ltr507-lightAndProximity.py'
            const cleanName = originalName.replace(/-/g, '_');      // e.g. 'ltr507_lightAndProximity.py'
          
            const tempPath = path.join(os.tmpdir(), cleanName);     // local renamed download path
          
            // Download the file (saving it with the clean name)
            await this.downloadFile(file.download_url, tempPath);
          
            // Upload to device with the clean filename (underscores only)
            const uploadCmd = `mpremote connect ${port} fs cp "${tempPath}" :"${cleanName}"`;
          
            this.outputChannel.appendLine(`⬆ Uploading ${cleanName}`);
            await execCommand(uploadCmd);
          }
          

          vscode.window.showInformationMessage(`✅ ${pyFiles.length} files from ${sensor} uploaded to device.`);
          this._view?.webview.postMessage({ command: 'triggerListFiles', port });

        } catch (err) {
          vscode.window.showErrorMessage(`Failed to fetch or upload files for ${sensor}`);
          this.outputChannel.appendLine(`❌ Error: ${err}`);
        }
      });
    }).on('error', err => {
      vscode.window.showErrorMessage(`Failed to access GitHub API: ${err.message}`);
    });
  }




  // Handle deleting a file from the device using os.remove()
  else if (message.command === 'deleteFile') {
    // Build the Python command to delete the file on the device
    const delCmd = `mpremote connect ${port} exec "import os; os.remove('${message.filename}')"`;  

    // Execute the delete command
    exec(delCmd, (err, stdout, stderr) => {
      if (err) {
        // If something went wrong, show an error message
        vscode.window.showErrorMessage(`Failed to delete file: ${stderr || err.message}`);
      } else {
        // Confirm success to the user
        vscode.window.showInformationMessage(`Deleted ${message.filename} successfully.`);

        // Refresh the file list on the frontend
        this._view?.webview.postMessage({ command: 'triggerListFiles', port });
      }
    });
  }

});
}

// Loads the HTML content for the Webview panel from an external file
private getHtml(): string {
  // Construct an absolute path to the HTML file in the extension directory
  const htmlPath = path.join(this.context.extensionPath, 'src', 'panel', 'index.html');

  // Read the contents of the HTML file as a UTF-8 string
  let html = fs.readFileSync(htmlPath, 'utf8');

  // Return the raw HTML string to be used in the Webview
  return html;
}

}
