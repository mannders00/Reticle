# Reticle — common commands.
#
#   make desktop-dev     run the Tauri desktop app with live frontend
#   make desktop         build the desktop app bundle (.app / .dmg)
#   make daemon          build the native single-binary daemon (UI embedded)
#   make daemon-dev      run the daemon locally, serving src/ from disk
#   make daemon-all      cross-compile the daemon for every supported platform → dist/
#   make deploy-pi PI=pi@host   scp the arm64 daemon to a Raspberry Pi
#   make serve           static mock server (no backend, demo data)
#   make check           cargo check the whole workspace
#   make toolchain       one-time: install zig targets for cross-compiling
#
# The daemon is Unix-only for now (the pty layer in core/src/terminal.rs
# uses forkpty via nix) — Linux + macOS targets below; Windows would need
# the terminal feature gated out first.

# Linux cross-targets build via cargo-zigbuild (musl → fully static, no
# glibc version worries). macOS targets build natively with cargo.
LINUX_TARGETS := aarch64-unknown-linux-musl x86_64-unknown-linux-musl armv7-unknown-linux-musleabihf
MACOS_TARGETS := aarch64-apple-darwin x86_64-apple-darwin

# dist/ name suffix per target triple
name-aarch64-unknown-linux-musl      := linux-arm64
name-x86_64-unknown-linux-musl       := linux-x64
name-armv7-unknown-linux-musleabihf  := linux-armv7
name-aarch64-apple-darwin            := macos-arm64
name-x86_64-apple-darwin             := macos-x64

.PHONY: desktop desktop-dev daemon daemon-dev daemon-all deploy-pi serve check toolchain clean publish-oss \
        $(addprefix daemon-,$(foreach t,$(LINUX_TARGETS) $(MACOS_TARGETS),$(name-$(t))))

# ---- desktop (Tauri) ----

desktop-dev:
	bun run tauri dev

desktop:
	bun run tauri build

# ---- daemon ----

daemon:
	cd daemon && cargo build --release
	@ls -lh target/release/reticle-daemon | awk '{print "→ target/release/reticle-daemon (" $$5 ")"}'

# Dev loop: UI served from disk (edit src/ without rebuilding), throwaway
# config, terminals on, open access.
daemon-dev:
	cd daemon && cargo run --release -- --port 8788 --config /tmp/reticle-dev.yaml --root ../src --enable-terminal --open

# Cross-compile the full matrix into dist/reticle-daemon-<platform>
daemon-all: $(addprefix daemon-,$(foreach t,$(LINUX_TARGETS) $(MACOS_TARGETS),$(name-$(t))))
	@echo && ls -lh dist/

define BUILD_LINUX
daemon-$(name-$(1)):
	cd daemon && cargo zigbuild --release --target $(1)
	@mkdir -p dist
	cp target/$(1)/release/reticle-daemon dist/reticle-daemon-$(name-$(1))
endef
$(foreach t,$(LINUX_TARGETS),$(eval $(call BUILD_LINUX,$(t))))

define BUILD_MACOS
daemon-$(name-$(1)):
	cd daemon && cargo build --release --target $(1)
	@mkdir -p dist
	cp target/$(1)/release/reticle-daemon dist/reticle-daemon-$(name-$(1))
endef
$(foreach t,$(MACOS_TARGETS),$(eval $(call BUILD_MACOS,$(t))))

# scp the Pi binary over: make deploy-pi PI=pi@raspberrypi.local
PI ?=
deploy-pi: daemon-linux-arm64
	@test -n "$(PI)" || (echo "usage: make deploy-pi PI=user@host" && exit 2)
	ssh $(PI) mkdir -p reticle
	scp dist/reticle-daemon-linux-arm64 $(PI):reticle/reticle-daemon
	@echo "on the pi:  tmux new -s reticle"
	@echo "            cd reticle && ./reticle-daemon --config ./topology.yaml \\"
	@echo "              --edit-token <secret> --view-token <secret> --enable-terminal"

# ---- misc ----

serve:
	bash scripts/reticle-serve.sh

# Snapshot the open-source tree (everything minus daemon/ + internal
# docs) into ../reticle-oss and push it to the public GitHub mirror.
publish-oss:
	bash scripts/publish-oss.sh

check:
	cargo check --workspace
	cd daemon && cargo check

# One-time setup for cross-compiling (zig + rust std for each target)
toolchain:
	@which zig >/dev/null || brew install zig
	@which cargo-zigbuild >/dev/null || cargo install cargo-zigbuild
	rustup target add $(LINUX_TARGETS) $(MACOS_TARGETS)

clean:
	cargo clean
	cd daemon && cargo clean
	rm -rf dist
