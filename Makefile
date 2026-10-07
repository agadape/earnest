# Anchor 1.2 builds SBPF v3 by default, which LiteSVM 0.10 (the test VM) cannot load, so every
# build here targets SBPF v0. Devnet and mainnet accept both.
BUILD_FLAGS := --arch v0 --tools-version v1.52

.PHONY: build test localnet deploy-devnet

build:
	anchor build $(BUILD_FLAGS)

test: build
	cargo test

localnet: build
	bash scripts/localnet.sh

deploy-devnet: build
	anchor deploy --provider.cluster devnet
