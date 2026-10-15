import { useId } from "react";
import type { RegistrationConfig, RegistrationInput } from "@confsys/contracts";
type Answers = RegistrationInput["answers"];
// Pure controlled form rendering; server validates visibility and required answers.
export function RegistrationFields({
  fields,
  answers,
  onChange,
  projectFields,
}: {
  fields: RegistrationConfig["fields"];
  answers: Answers;
  onChange: (value: Answers) => void;
  projectFields: (
    fields: RegistrationConfig["fields"],
    answers: Answers,
  ) => RegistrationConfig["fields"];
}) {
  const prefix = useId();
  const set = (key: string, value: Answers[string]) =>
    onChange({ ...answers, [key]: value });
  return (
    <>
      {projectFields(fields, answers).map((field) => {
        const id = `${prefix}-${field.key}`,
          value = answers[field.key];
        if (field.type === "description")
          return <p key={field.key}>{field.label}</p>;
        return (
          <div key={field.key}>
            <label htmlFor={id}>
              {field.label}
              {field.required ? "（必填）" : ""}
            </label>
            {field.type === "select" || field.type === "multiselect" ? (
              <select
                id={id}
                name={field.key}
                required={field.required}
                multiple={field.type === "multiselect"}
                value={
                  field.type === "multiselect"
                    ? Array.isArray(value)
                      ? value
                      : []
                    : typeof value === "string"
                      ? value
                      : ""
                }
                onChange={(e) =>
                  set(
                    field.key,
                    field.type === "multiselect"
                      ? Array.from(
                          e.target.selectedOptions,
                          (option) => option.value,
                        )
                      : e.target.value,
                  )
                }
              >
                {field.type === "select" && <option value="">請選擇</option>}
                {field.options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : field.type === "long_text" ? (
              <textarea
                id={id}
                name={field.key}
                required={field.required}
                maxLength={4000}
                value={typeof value === "string" ? value : ""}
                onChange={(e) => set(field.key, e.target.value)}
              />
            ) : field.type === "checkbox" ? (
              <input
                id={id}
                name={field.key}
                type="checkbox"
                required={field.required}
                checked={value === true}
                onChange={(e) => set(field.key, e.target.checked)}
              />
            ) : (
              <input
                id={id}
                name={field.key}
                type={
                  field.type === "number"
                    ? "number"
                    : field.type === "date"
                      ? "date"
                      : "text"
                }
                step={field.type === "number" ? "any" : undefined}
                required={field.required}
                maxLength={300}
                value={
                  typeof value === "string" || typeof value === "number"
                    ? value
                    : ""
                }
                onChange={(e) =>
                  set(
                    field.key,
                    field.type === "number" && e.target.value !== ""
                      ? Number(e.target.value)
                      : e.target.value,
                  )
                }
              />
            )}
          </div>
        );
      })}
    </>
  );
}
