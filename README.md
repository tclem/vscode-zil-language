# zil-language README

This extension adds editing support for ZIL&mdash;the Zork Implementation Language&mdash;as well as MDL, which ZIL is based on. It associates itself with `.zil` and `.mud` files.

## Features

This extension implements:

* Syntax highlighting
  * With "rainbow bracket" coloration to indicate nesting levels, based on Clojure Warrior by Nikita Prokopov
* Snippets
* Hover help
* Signature help
* Go to definition
* Go to symbol (per file or per workspace)
* ZILF REPL terminal
* ZILF/ZAPF build tasks
* Source-level debugging

## Requirements

### ZILF

Some features require an installation of ZILF (the ZIL compiler).

To set this up, [download the latest release from Bitbucket](https://bitbucket.org/jmcgrew/zilf/downloads/) (e.g. `zilf-0.8.zip`), and extract it somewhere. Navigate to the folder containing `zilf.exe` and `zapf.exe` when prompted by the extension, or set the `zil.compiler.path` and `zil.assembler.path` settings to point to those files.

### ZLR (optional)

Debugging requires a recent build of ZLR, a [Z-machine](https://en.wikipedia.org/wiki/Z-machine) interpreter.

Such a build is included in this extension package, but if you have another one, you can configure the extension to use it instead.

**NOTE**: The debugger has only been tested on Windows so far. On other operating systems, you may be able to use the debugger by installing [Mono](https://www.mono-project.com/).

## Extension Settings

This extension contributes the following settings, which can be customized per folder:

* `zil.autoDetect`: enable/disable the ZIL build tasks
* `zil.mainFile`: the name of the main `.zil` file, or **null** to use the name of the folder with `.zil` added
* `zil.compiler.path`: path to `zilf.exe`
* `zil.assembler.path`: path to `zapf.exe`
* `zil.debugger.path`: path to `ConsoleZLR.exe` (optional)
* `zil.rainbowBrackets.enabled`: enable/disable the "rainbow brackets" feature
* `zil.rainbowBrackets.bracketColors`: list of colors to use for rainbow brackets
* `zil.rainbowBrackets.cycleBracketColors`: enable/disable repeating colors for very deep nesting levels
* `zil.misplacedBracketStyle`: appearance of misplaced brackets
* `zil.matchedBracketStyle`: appearance of the matched pair of brackets at the cursor

## Known Issues

### IntelliSense
* Definitions in ZIL code are only reindexed when the file is saved.

### Editor
* When this extension's bracket highlighting conflicts with VS Code's, both pairs are highlighted.

### Debugger
* The debugger has only been tested on Windows.
* Breakpoints can't be set while the game is running.
  - Workaround: Pause the game, set the breakpoint, resume.
* Source line breakpoints can't be set in some cases where the extension and ZILF calculate different
  relative paths for the source file.
  - Workaround: Set a named function breakpoint.
