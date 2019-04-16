# Change Log

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Semantic Versioning](http://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Fixed schema validation errors when parsing `tasks.json` when the file contains
  "JSON with Comments" syntax instead of plain JSON.

## [0.2.5] (April 10, 2019)

### Added

- More completions and signatures for built-in ZIL functions.
- License field in `package.json`.

### Fixed

- Fixed debugger not working due to a mealy webpack.

## [0.2.4] (April 6, 2019)

### Changed

- The extension is now built as a bundle with `webpack`.

### Fixed

- Fixed build tasks not working with spaces in `zil.compiler.path` or
  `zil.assembler.path`.
- Fixed bracket colorizer getting confused by comments near close brackets and
  missing a subsequent open bracket, as in `(;FOO) (BAR)`.

## [0.2.3] (May 7, 2018)

### Added

- Syntax highlighter for ZAP.

### Changed

- Highlight `CONTFCN` property name in object definitions.
- Changed extension category from "Languages" to "Programming Languages".

### Fixed

- Fixed double bracket highlights.
- Fixed flag names not being recognized by IntelliSense when prefixed by a comma.
- Fixed incorrect paths in Problems pane for compiler errors in files other than
  the main file.
  * If you've used "Configure Default Build Task", you'll need to add the new
    problem matcher `$zilf-absolute` to the config in `tasks.json`, or just delete
    it and configure it again. See <https://github.com/Microsoft/vscode/issues/449>.

## [0.2.2] (March 21, 2018)

### Fixed

- Fixed stack trace not appearing when stopped at an instruction with no line info.
- ZLR: Fixed bug in @check_arg_count that broke debugging on V5.
- ZLR: Fixed bug where after some instructions in certain JIT conditions, execution
  continued at the wrong place.

## [0.2.1] (March 19, 2018)

### Changed

- Fixed repository and issue tracker links in `package.json`.

## [0.2.0] (March 19, 2018)

### Added

- New debug adapter for source-level debugging, based on ZLR.
- Signature help for builtin MDL/ZIL functions.
- Symbols for local variables, including activations.
- Symbols for parts of objects (properties, flags, vocab words).

### Changed

- Tweaked build tasks.
- Completions are sorted.
- Some duplicate symbols are hidden.

## [0.1.0] (January 17, 2018)

- Initial release.

[Unreleased]: https://bitbucket.org/zilf/vscode-zil-language/branches/compare/default..0.2.5
[0.2.5]: https://bitbucket.org/zilf/vscode-zil-language/branches/compare/0.2.5..0.2.4
[0.2.4]: https://bitbucket.org/zilf/vscode-zil-language/branches/compare/0.2.4..0.2.3
[0.2.3]: https://bitbucket.org/zilf/vscode-zil-language/branches/compare/0.2.3..0.2.2
[0.2.2]: https://bitbucket.org/zilf/vscode-zil-language/branches/compare/0.2.2..0.2.1
[0.2.1]: https://bitbucket.org/zilf/vscode-zil-language/branches/compare/0.2.1..0.2.0
[0.2.0]: https://bitbucket.org/zilf/vscode-zil-language/branches/compare/0.2.0..0.1.0
[0.1.0]: https://bitbucket.org/zilf/vscode-zil-language/src/0.1.0/vscode/zil-language/?at=0.1.0
