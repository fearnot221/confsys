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
export function Layout({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <main
      id="main-content"
      className={className ? `layout ${className}` : "layout"}
    >
      {children}
    </main>
  );
}
export type AppBarLink = { href: string; label: string };
/** Global workspace bar: plain links only; visibility of features stays server-decided. */
export function AppBar({
  title,
  links,
  currentPath,
}: {
  title: string;
  links: AppBarLink[];
  currentPath: string;
}) {
  return (
    <header className="app-bar">
      <div className="app-bar__inner">
        <a className="app-bar__mark" href="/dashboard">
          <span className="app-bar__glyph" aria-hidden="true" />
          <span className="app-bar__label">{title}</span>
        </a>
        <nav aria-label="工作區導覽 / Workspace">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              aria-current={link.href === currentPath ? "page" : undefined}
            >
              {link.label}
            </a>
          ))}
        </nav>
      </div>
    </header>
  );
}
