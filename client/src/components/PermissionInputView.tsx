/**
 * @file PermissionInputView.tsx
 * @description Renders the typed fields produced by `summarisePermissionInput`
 * for a Claude Code permission prompt — commands as shell blocks, edits as a
 * before/after diff, AskUserQuestion as its real questions and options. Purely
 * presentational; it never linkifies a URL or executes anything, because every
 * value here is untrusted input the user is being asked to approve.
 * @author Tanveer Hoque <tanvoid0@gmail.com>
 */

import { useTranslation } from "react-i18next";
import type { FieldLabel, PermissionField } from "../lib/permission-input";

const BLOCK = "rounded-lg border border-border bg-surface-1 p-2 text-xs text-gray-300";

function Label({ label, raw }: { label: FieldLabel; raw?: string }) {
  const { t } = useTranslation("common");
  const text = label ? t(`permissions.field.${label}`) : raw;
  if (!text) return null;
  return (
    <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-gray-500">{text}</div>
  );
}

function Field({ field }: { field: PermissionField }) {
  const { t } = useTranslation("common");

  switch (field.kind) {
    case "code":
      return (
        <div>
          <Label label={field.label} />
          <pre
            className={`${BLOCK} max-h-52 overflow-auto whitespace-pre-wrap break-words font-mono`}
          >
            {field.value}
          </pre>
        </div>
      );

    case "path":
      return (
        <div>
          <Label label={field.label} />
          <div
            className={`${BLOCK} truncate font-mono`}
            style={{ direction: "rtl", textAlign: "left" }}
            title={field.value}
          >
            <bdi>{field.value}</bdi>
          </div>
        </div>
      );

    case "url":
      return (
        <div>
          <Label label={field.label} />
          {/* Deliberately not an anchor: untrusted, and clicking is not approving. */}
          <div className={`${BLOCK} break-all font-mono`}>{field.value}</div>
        </div>
      );

    case "text":
      return (
        <div>
          <Label label={field.label} />
          <div className="text-xs text-gray-300">{field.value}</div>
        </div>
      );

    case "diff":
      return (
        <div>
          <Label label={field.label} />
          <div className="overflow-hidden rounded-lg border border-border">
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words border-b border-border bg-red-500/10 p-2 font-mono text-xs text-red-200">
              {field.before || t("permissions.field.emptyBefore")}
            </pre>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words bg-emerald-500/10 p-2 font-mono text-xs text-emerald-200">
              {field.after || t("permissions.field.emptyAfter")}
            </pre>
          </div>
        </div>
      );

    case "questions":
      return (
        <div className="flex flex-col gap-2">
          {field.items.map((item, i) => (
            <div key={i} className={BLOCK}>
              <div className="font-medium text-gray-200">{item.question}</div>
              {item.options.length > 0 && (
                <ul className="mt-1.5 flex flex-col gap-1">
                  {item.options.map((opt, j) => (
                    <li key={j} className="flex gap-1.5">
                      <span className="text-gray-600" aria-hidden>
                        •
                      </span>
                      <span className="min-w-0">
                        <span className="text-gray-200">{opt.label}</span>
                        {opt.description && (
                          <span className="text-gray-500"> — {opt.description}</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      );

    case "json":
      return (
        <div>
          <Label label={field.label} raw={field.rawKey} />
          <pre
            className={`${BLOCK} max-h-52 overflow-auto whitespace-pre-wrap break-all font-mono`}
          >
            {field.value}
          </pre>
        </div>
      );
  }
}

export function PermissionInputView({ fields }: { fields: PermissionField[] }) {
  return (
    <div className="flex flex-col gap-2">
      {fields.map((field, i) => (
        <Field key={i} field={field} />
      ))}
    </div>
  );
}
