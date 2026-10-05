# Capability awareness and MCP connection UI

CodeMe uses a native capability manager inspired by the discover/enable pattern in the
Apache-2.0 licensed Goose Extension Manager.

Reference implementation:
- https://github.com/aaif-goose/goose
- `documentation/docs/mcp/extension-manager-mcp.md`

CodeMe does **not** import Goose's Rust runtime. The implementation fits CodeMe's existing
extension/provider architecture and leaves the locked OpenHands-style canonical agent loop
untouched.

## Model-facing tools

### `codeme.capabilities`

Returns a live catalog of:

- built-in and workspace skills
- native helpers such as Research Engineer and Project Brain
- configured MCP servers and current connection state

The tool description includes a bounded current summary so the model knows capability
discovery is available during normal runs.

### `codeme.request_connection`

Returns a safe request when an external service would help but is not connected. It never
authenticates, grants permission, or claims a connection exists.

- internal skills/native helpers -> `use_directly`
- already connected MCP -> `already_connected`
- disabled/configured/unavailable/unknown service -> `user_action_required`

## UI

CodeMe Settings > **Capabilities & MCP** uses the same registry:

- Connected / Configured / Disabled / Unavailable states
- Tool count when known
- Connect / Disconnect for already configured MCP servers
- Add an HTTP MCP connection with an optional bearer token
- Advanced JSON retained for stdio and unusual configurations

Bearer tokens continue to use the existing VS Code SecretStorage path.

## Safety

The agent may **request** a connection, but it cannot grant itself credentials or silently
enable an unknown external service. User-controlled settings remain the authority.
