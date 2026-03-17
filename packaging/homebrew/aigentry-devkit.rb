class AigentryDevkit < Formula
  desc "Cross-platform installer and tooling bundle for the aigentry ecosystem"
  homepage "https://github.com/dmsdc-ai/aigentry-devkit"
  url "https://registry.npmjs.org/@dmsdc-ai/aigentry-devkit/-/aigentry-devkit-0.0.5.tgz"
  sha256 "6b84197ef76b44f0a8c9eced78537c7f17a69a0c0dae38106534a32b7e0ef73d"
  license "MIT"

  depends_on "node"

  def install
    libexec.install Dir["package/*"]
    (bin/"aigentry-devkit").write_env_script libexec/"bin/aigentry-devkit.js", PATH: ENV["PATH"]
  end

  test do
    assert_match "aigentry-devkit CLI", shell_output("#{bin}/aigentry-devkit --help")
  end
end
