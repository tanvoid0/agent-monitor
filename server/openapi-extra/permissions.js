/**
 * @file Supplementary OpenAPI 3.0 fragments for the permission relay: the
 * `PermissionRequest` http-hook ingress at `/api/hooks/permission-request`
 * (server/routes/hooks.js → server/lib/permission-relay.js) and the
 * dashboard-side `/api/permissions` routes (server/routes/permissions.js).
 * Exports `{ tags, schemas, paths }` for merging by server/openapi-extra.js.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const tags = [
  {
    name: "Permissions",
    description:
      "Answer Claude Code permission prompts from the dashboard. Claude Code's PermissionRequest hook (installed as an `http` hook) blocks on `/api/hooks/permission-request`; the UI resolves it via `/api/permissions/{id}/decision`.",
  },
];

const schemas = {
  PermissionUpdate: {
    type: "object",
    description:
      "One Claude Code permission update entry (`addRules`, `setMode`, …) as sent in `permission_suggestions` and echoed back as `updatedPermissions`. Passed through opaquely.",
    required: ["type"],
    properties: {
      type: { type: "string", example: "addRules" },
      behavior: { type: "string", enum: ["allow", "deny", "ask"] },
      destination: {
        type: "string",
        enum: ["session", "localSettings", "projectSettings", "userSettings"],
      },
      rules: {
        type: "array",
        items: {
          type: "object",
          properties: {
            toolName: { type: "string" },
            ruleContent: { type: "string" },
          },
        },
      },
    },
    additionalProperties: true,
  },
  PermissionRequest: {
    type: "object",
    description:
      "A permission prompt parked by the relay. Also the payload of the `permission_request` WebSocket message.",
    required: ["id", "tool_name", "tool_input", "received_at", "expires_at"],
    properties: {
      id: { type: "string", format: "uuid" },
      session_id: { type: "string", nullable: true },
      cwd: { type: "string", nullable: true },
      tool_name: { type: "string", example: "Bash" },
      tool_input: { type: "object", additionalProperties: true },
      permission_mode: { type: "string", nullable: true, example: "default" },
      permission_suggestions: {
        type: "array",
        items: { $ref: "#/components/schemas/PermissionUpdate" },
      },
      received_at: { type: "string", format: "date-time" },
      expires_at: {
        type: "string",
        format: "date-time",
        description:
          "When the relay stops holding the prompt and Claude Code falls back to its terminal prompt (`DASHBOARD_PERMISSION_HOLD_MS`, default 60000).",
      },
    },
  },
  PermissionDecisionRequest: {
    type: "object",
    required: ["behavior"],
    properties: {
      behavior: {
        type: "string",
        enum: ["allow", "deny", "defer"],
        description:
          "`allow`/`deny` answer the prompt on the user's behalf; `defer` returns no decision so Claude Code shows its own terminal prompt immediately.",
      },
      message: {
        type: "string",
        description: "For `deny`: reason relayed to Claude (truncated to 2000 chars).",
      },
      updatedPermissions: {
        type: "array",
        items: { $ref: "#/components/schemas/PermissionUpdate" },
        description:
          'For `allow`: permission updates to apply, typically one of the request\'s `permission_suggestions` echoed back ("Allow always").',
      },
    },
  },
  PermissionHookResponse: {
    type: "object",
    description:
      "Body Claude Code receives when the held hook request completes. Empty object = no decision (defer, hold timeout, or UI disconnect) — Claude Code then prompts in the terminal as usual.",
    properties: {
      hookSpecificOutput: {
        type: "object",
        properties: {
          hookEventName: { type: "string", enum: ["PermissionRequest"] },
          decision: {
            type: "object",
            properties: {
              behavior: { type: "string", enum: ["allow", "deny"] },
              message: { type: "string" },
              updatedPermissions: {
                type: "array",
                items: { $ref: "#/components/schemas/PermissionUpdate" },
              },
            },
          },
        },
      },
    },
  },
};

const paths = {
  "/api/hooks/permission-request": {
    post: {
      tags: ["Permissions"],
      summary: "PermissionRequest http-hook ingress (long-held)",
      description:
        "Called by Claude Code's `PermissionRequest` hook (type `http`, installed by `npm run install-hooks` / server startup). The response is **held open** until the dashboard answers or `DASHBOARD_PERMISSION_HOLD_MS` elapses. Subject to the hook token guard when `DASHBOARD_HOOK_TOKEN` is set. Not meant to be called by browsers.",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["hook_event_name", "tool_name"],
              properties: {
                hook_event_name: { type: "string", enum: ["PermissionRequest"] },
                session_id: { type: "string" },
                cwd: { type: "string" },
                permission_mode: { type: "string" },
                tool_name: { type: "string" },
                tool_input: { type: "object", additionalProperties: true },
                permission_suggestions: {
                  type: "array",
                  items: { $ref: "#/components/schemas/PermissionUpdate" },
                },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: "Decision (or `{}` for no decision)",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/PermissionHookResponse" },
            },
          },
        },
        400: {
          description: "Payload is not a PermissionRequest hook",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } },
          },
        },
      },
    },
  },
  "/api/permissions": {
    get: {
      tags: ["Permissions"],
      summary: "List parked permission prompts",
      description:
        "Prompts still waiting for an answer (the UI fetches this on mount; live changes arrive as `permission_request` / `permission_resolved` WebSocket messages). Same-origin guarded like `/api/run`.",
      responses: {
        200: {
          description: "Pending prompts",
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["pending", "hold_ms"],
                properties: {
                  pending: {
                    type: "array",
                    items: { $ref: "#/components/schemas/PermissionRequest" },
                  },
                  hold_ms: { type: "integer", example: 60000 },
                },
              },
            },
          },
        },
      },
    },
  },
  "/api/permissions/{id}/decision": {
    post: {
      tags: ["Permissions"],
      summary: "Answer a parked permission prompt",
      description:
        "Releases the held hook request with an allow/deny decision, or with no decision (`defer`). Same-origin guarded: browser requests must come from a loopback origin. 404 once the prompt has already been answered, expired, or cancelled.",
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/PermissionDecisionRequest" },
          },
        },
      },
      responses: {
        200: {
          description: "Decision delivered",
          content: {
            "application/json": {
              schema: { type: "object", properties: { ok: { type: "boolean", enum: [true] } } },
            },
          },
        },
        400: {
          description: "Invalid behavior",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } },
          },
        },
        403: {
          description: "Cross-origin browser request",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } },
          },
        },
        404: {
          description: "No pending prompt with that id",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } },
          },
        },
      },
    },
  },
};

module.exports = { tags, schemas, paths };
