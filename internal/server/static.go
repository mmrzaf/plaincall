package server

import (
	"io"
	"io/fs"
	"net/http"
	"path"
	"strings"
)

func (s *Server) healthz(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	_, _ = io.WriteString(w, "ok\n")
}

// static serves the web app. Any path that is not a file is a room address, so
// it gets the app's index page and the app reads the room name from the URL.
func (s *Server) static(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/") {
		writeError(w, http.StatusNotFound, "not_found", "No such endpoint.")
		return
	}

	name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
	if name != "" && name != "index.html" && isFile(s.assets, name) {
		if strings.HasPrefix(name, "assets/") {
			// Build output is named by content hash, so it never changes.
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			w.Header().Set("Cache-Control", "public, max-age=3600")
		}
		http.ServeFileFS(w, r, s.assets, name)
		return
	}

	index, err := fs.ReadFile(s.assets, "index.html")
	if err != nil {
		http.Error(w, "The web app has not been built. Run 'make web' first.", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	_, _ = w.Write(index)
}

func isFile(fsys fs.FS, name string) bool {
	info, err := fs.Stat(fsys, name)
	return err == nil && info.Mode().IsRegular()
}
