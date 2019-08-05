A portable EXE file editor supporting parsing and replacing resources, designed
to replace `rcedit` for cases like CI where using Windows would otherwise be
overkill.

It is still very early, only just barely enough for our internal usage is
currently implemented, but I hope to fill this out quite a bit more, when I will
fill out the documentation. For now, the CLI usage should be somewhat usable
depending on inputs, but the API is very unstable.

The main limitation is the lack of section resizing and moving, meaning you
can't increase the size of the included resources yet.

## CLI Usage

Designed to allow replacing `rcedit`:

```
$ exe-edit --help
Usage: exe-edit INPUT_EXE OUTPUT_EXE [options]

Options:
  [--console]                Change the subsystem to console:
                              * Opens a command prompt when started from windows.
                              * Waits for exit when started from a command prompt.
 | --gui]                    Change the subsystem to GUI:
                              * No automatic UI created.
                              * Will immediately return to a command prompt, but
                                output will still be printed.

  [--icon ICO_PATH           Replace all icon resources with a new icon.
 | --no-icon]                Remove all icon resources.

  [--file-version VERSION]   Set the binary file version.
  [--product-version VERSION]
                             Set the binary product version.

  [--set-version NAME VALUE] Set a version string.
  [--delete-version NAME]    Delete a version string.
```
