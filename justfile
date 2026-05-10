version := `node -p "require('./package.json').version"`

default:
    @just --list

lint:
    pnpm compile

build:
    pnpm build

# Build, package as a store-ready zip, tag the current version, push the tag. Requires a clean working tree and an unused tag.
publish: build
    @test -z "$(git status --porcelain)" || { echo "error: working tree is dirty"; exit 1; }
    @! git rev-parse "v{{ version }}" >/dev/null 2>&1 || { echo "error: tag v{{ version }} already exists"; exit 1; }
    pnpm zip
    git tag -a "v{{ version }}" -m "v{{ version }}"
    git push origin "v{{ version }}"
