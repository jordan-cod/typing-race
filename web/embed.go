// Package web carries the built site into the binary.
//
// The directory is produced by `bun run build` and is not in git, so `all:dist` is matched
// against whatever the build step left behind. A repository checkout with no build still
// compiles: the pattern finds .gitkeep, the server finds no index.html, and it says so instead
// of refusing to start.
package web

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var embedded embed.FS

// Site is the built site rooted at dist, so paths look the way the browser asks for them.
func Site() fs.FS {
	site, err := fs.Sub(embedded, "dist")
	if err != nil {
		panic(err)
	}
	return site
}
