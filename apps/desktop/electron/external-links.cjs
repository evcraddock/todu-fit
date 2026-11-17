// Never load external pages or custom protocols inside the privileged app window.
function createExternalLinkHandler(openExternal, onError) {
  return ({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "https:" || parsed.protocol === "http:") {
        Promise.resolve()
          .then(() => openExternal(parsed.href))
          .catch(onError);
      }
    } catch {
      // Invalid URLs are denied, like unsupported protocols.
    }
    return { action: "deny" };
  };
}

module.exports = { createExternalLinkHandler };
