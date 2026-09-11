#!/usr/bin/env bash
# Veil 指纹浏览器 —— 一键构建 .app + .pkg
set -euo pipefail

APP_NAME="Veil"
BUNDLE_ID="com.veil.browser"
VERSION="${VEIL_VERSION:-1.0.0}"
BUILD="${VEIL_BUILD:-100}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIST="$ROOT/dist"
STAGE="$DIST/stage"
APP="$STAGE/$APP_NAME.app"
SDK="$(xcrun --show-sdk-path)"
ARCHS="${VEIL_ARCHS:-native}"

say() { printf "\033[1;36m▸\033[0m %s\n" "$*"; }
ok()  { printf "\033[1;32m✓\033[0m %s\n" "$*"; }
err() { printf "\033[1;31m✗\033[0m %s\n" "$*" >&2; }

rm -rf "$STAGE"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources" "$DIST"

# ---------- 1. 架构参数 ----------
HOST_ARCH="$(uname -m)"
case "$ARCHS" in
  native)  ARCH_FLAGS=(-target "${HOST_ARCH}-apple-macos13.0") ; ARCH_LABEL="$HOST_ARCH" ;;
  arm64)   ARCH_FLAGS=(-target arm64-apple-macos13.0)          ; ARCH_LABEL="arm64" ;;
  x86_64)  ARCH_FLAGS=(-target x86_64-apple-macos13.0)         ; ARCH_LABEL="x86_64" ;;
  universal) ARCH_LABEL="universal" ;;
  *) err "未知 VEIL_ARCHS=$ARCHS"; exit 1 ;;
esac
say "目标架构: $ARCH_LABEL (host: $HOST_ARCH)"

SWIFT_SOURCES=($(find "$ROOT/app/Sources" -name '*.swift' | sort))
say "编译 ${#SWIFT_SOURCES[@]} 个 Swift 源文件…"

SWIFT_OPTS=(-O -wmo -sdk "$SDK" -parse-as-library
            -Xlinker -rpath -Xlinker /usr/lib/swift)
FRAMEWORKS=(-framework AppKit -framework WebKit -framework Network -framework CryptoKit -framework UniformTypeIdentifiers)

OPT_FLAG="${VEIL_OPT:--O}"
build_one() {
  local arch="$1" out="$2"
  swiftc $OPT_FLAG -sdk "$SDK" -target "${arch}-apple-macos13.0" \
         "${FRAMEWORKS[@]}" \
         -o "$out" "${SWIFT_SOURCES[@]}" 2>&1
}

if [ "$ARCH_LABEL" = "universal" ]; then
  mkdir -p "$DIST/tmp"
  say "  · arm64"
  build_one arm64 "$DIST/tmp/Veil-arm64"
  say "  · x86_64"
  build_one x86_64 "$DIST/tmp/Veil-x86_64"
  lipo -create -output "$APP/Contents/MacOS/$APP_NAME" "$DIST/tmp/Veil-arm64" "$DIST/tmp/Veil-x86_64"
  rm -rf "$DIST/tmp"
else
  build_one "$ARCH_LABEL" "$APP/Contents/MacOS/$APP_NAME"
fi
chmod +x "$APP/Contents/MacOS/$APP_NAME"
ok "二进制编译完成"

# ---------- 2. 资源 ----------
say "拷贝资源…"
mkdir -p "$APP/Contents/Resources/Web"
cp -R "$ROOT/app/Web/." "$APP/Contents/Resources/Web/"
sed -e "s/__VERSION__/$VERSION/" -e "s/__BUILD__/$BUILD/" "$ROOT/app/Info.plist" > "$APP/Contents/Info.plist"
printf 'APPL????' > "$APP/Contents/PkgInfo"

# 图标
if [ -f "$ROOT/app/Resources/AppIcon.icns" ]; then
  cp "$ROOT/app/Resources/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"
  ok "图标已安装"
elif command -v python3 >/dev/null 2>&1 && [ -f "$ROOT/tools/make_icon.py" ]; then
  say "生成图标…"
  python3 "$ROOT/tools/make_icon.py" "$ROOT/app/Resources/AppIcon.icns" >/dev/null 2>&1 || true
  [ -f "$ROOT/app/Resources/AppIcon.icns" ] && cp "$ROOT/app/Resources/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns" && ok "图标已生成"
fi

# ---------- 3. 签名 ----------
SIGN_IDENTITY="${VEIL_SIGN_IDENTITY:--}"
say "代码签名 (identity=$SIGN_IDENTITY)…"
if [ -f "$ROOT/app/entitlements.plist" ]; then
  codesign --force --options runtime --sign "$SIGN_IDENTITY" \
           --entitlements "$ROOT/app/entitlements.plist" \
           --timestamp=none "$APP" 2>/dev/null \
  || codesign --force --sign "$SIGN_IDENTITY" --entitlements "$ROOT/app/entitlements.plist" "$APP"
else
  codesign --force --sign "$SIGN_IDENTITY" "$APP"
fi
codesign --verify --verbose=1 "$APP" 2>&1 | sed 's/^/    /'
ok "签名完成"

# ---------- 4. 打包 pkg ----------
PKG_OUT="$DIST/$APP_NAME-$VERSION.pkg"
if [ "${VEIL_PKG:-1}" = "1" ]; then
  say "构建安装包…"
  COMPONENT_PKG="$DIST/$APP_NAME-component.pkg"
  pkgbuild --component "$APP" \
           --identifier "$BUNDLE_ID" \
           --version "$VERSION" \
           --install-location "/Applications" \
           --scripts "$ROOT/pkg/scripts" \
           "$COMPONENT_PKG" >/dev/null

  if [ -f "$ROOT/pkg/distribution.xml" ]; then
    sed -e "s/__VERSION__/$VERSION/" -e "s/__BUNDLE_ID__/$BUNDLE_ID/" \
        -e "s/__APP_NAME__/$APP_NAME/" "$ROOT/pkg/distribution.xml" > "$DIST/distribution.xml"
    productbuild --distribution "$DIST/distribution.xml" \
                 --package-path "$DIST" \
                 --resources "$ROOT/pkg/resources" \
                 "$PKG_OUT" >/dev/null 2>&1 || cp "$COMPONENT_PKG" "$PKG_OUT"
  else
    cp "$COMPONENT_PKG" "$PKG_OUT"
  fi
  rm -f "$COMPONENT_PKG" "$DIST/distribution.xml"
  ok "安装包: $PKG_OUT"
fi

# ---------- 5. 摘要 ----------
echo
ok "构建完成"
printf "    App : %s\n" "$APP"
[ -f "$PKG_OUT" ] && printf "    Pkg : %s\n" "$PKG_OUT"
printf "    体积: %s\n" "$(du -sh "$APP" | cut -f1)"
printf "    运行: open \"%s\"\n" "$APP"
