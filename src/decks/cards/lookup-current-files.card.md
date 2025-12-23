+++
label = "lookup_current_files_card"

[[actions]]
name = "lookup_current_files"
path = "../lookup-current-files.deck.ts"
description = "Return the current set of files available to the assistant."
+++

Use `lookup_current_files` when you need a list of files or directories in the
current workspace. Prefer a small `limit` and `maxDepth` unless a full tree is
explicitly required.
