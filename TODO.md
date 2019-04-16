# TODO for zil-language extension

## Future release

### Debugger

- Let user toggle breakpoints while game is running
- Disassembly view
    - Step by instruction
- Set start/end position of variable scopes
- Friendlier eval expressions for variables (e.g. <GETP ,PLAYER ,P?LDESC> instead of <GETP 100 40>)
- Disable "more" prompt
- Edit & Continue (trap)
- Fix path mismatches (should be able to set breakpoints in library code and game code easily)
- Conditional/hitcount breakpoints
- Start ZLR from the extension instead of using `runInTerminal`?
    - Debugger sends a custom event, extension creates the terminal and holds a reference
    - The extension can focus the terminal while running, and kill it when the session ends
- Implement `noDebug` launch option
    - Separate path setting? e.g. use Frotz for non-debug play
- Indicate debug state in window title, e.g. "advent.z3 (Running) - ZLR Debugger"
- Clearer indication when paused, esp. during input
    - Stop cursor blinking? Show a message?
- Disable debugger break hotkey when using TCP debug console?
- Download ZLR binaries on first run instead of shipping with extension

### Build Tasks

- Add a task to (re)generate abbreviations

### Linter

- Invoke ZILF as a linter (might need special support)

### Editor

- Color all `FORM`s like calls
- Grammar for .zap/.xzap
- Formatter (trap?)

### IntelliSense

- Show docstrings from source
- Cache parsed symbols, signatures, etc. in global or workspace state (see vscode-cache package)
- Tree view of objects
    - Separate views for editing and debugging
- HTML index of all symbols
- Progress bars?

--------------------------------------------------------------------------------------------------

## Not yet supported by vscode?

- Implement remaining ZILF/ZAPF command-line options as task options
