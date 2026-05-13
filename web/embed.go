// Package web embeds the built browser app.
package web

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var dist embed.FS

// Assets returns the built app with index.html at its root.
func Assets() (fs.FS, error) {
	return fs.Sub(dist, "dist")
}
