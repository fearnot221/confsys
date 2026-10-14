import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
} from "react";
export function Button(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...props} />;
}
export function Input({
  label,
  id,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; id: string }) {
  return (
    <label htmlFor={id}>
      {label}
      <input id={id} {...props} />
    </label>
  );
}
export function Status({
  label,
  healthy,
}: {
  label: string;
  healthy: boolean;
}) {
  return (
    <span className={healthy ? "status status-up" : "status status-down"}>
      {label}
    </span>
  );
}
export function Layout({ children }: { children: ReactNode }) {
  return (
    <main id="main-content" className="layout">
      {children}
    </main>
  );
}
