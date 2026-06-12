package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/mmrzaf/plaincall/internal/config"
	"github.com/mmrzaf/plaincall/internal/httpapi"
	"github.com/mmrzaf/plaincall/internal/webui"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{}))
	cfg, err := config.Load()
	if err != nil {
		logger.Error("invalid configuration", "error", err)
		os.Exit(1)
	}
	staticFiles, err := webui.FS()
	if err != nil {
		logger.Error("load embedded frontend", "error", err)
		os.Exit(1)
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	server := httpapi.New(cfg, logger, staticFiles)
	if err := httpapi.ListenAndServe(ctx, cfg, logger, server.Handler()); err != nil {
		logger.Error("server stopped", "error", err)
		os.Exit(1)
	}
}
