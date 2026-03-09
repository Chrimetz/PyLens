# Python Code Metrics Extension

This VS Code extension computes code complexity metrics for Python source files using Radon.

## Prerequisites

The extension relies on a helper Python script located at `src/analyzer/analyzer.py`.
The script depends on the [radon](https://pypi.org/project/radon/) package.  
For convenience the extension attempts to install this dependency automatically when the package is installed (see the `postinstall` npm script) or when the script is first executed.  
You can also install it manually in your Python environment:

```bash
pip install radon
```

If the automatic install fails you'll see an error message in the **Log (Extension Host)** output with instructions.

## Development

To build the extension:

```bash
npm install
npm run compile
```

You can also start the extension in the debugger (`F5`).

---

Any contributions or improvements are welcome!