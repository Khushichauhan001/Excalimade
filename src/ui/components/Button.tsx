import type { ComponentPropsWithRef, ReactNode } from "react";

export interface ButtonProps extends ComponentPropsWithRef<"button"> {
  /** primary = filled violet, secondary = subtle filled, ghost = transparent, danger = red, icon = square icon button */
  variant?: "primary" | "secondary" | "ghost" | "danger" | "icon";
  size?: "sm" | "md" | "lg";
  icon?: ReactNode;
  /** Pressed/selected look (also sets aria-pressed for icon buttons). */
  active?: boolean;
}

export function Button({ variant = "secondary", size = "md", icon, active, className, children, type = "button", ...rest }: ButtonProps) {
  const cls = [
    "ui-btn",
    `ui-btn--${variant}`,
    `ui-btn--${size}`,
    active ? "is-active" : "",
    icon && !children ? "ui-btn--icon-only" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button type={type} className={cls} aria-pressed={variant === "icon" && active !== undefined ? active : undefined} {...rest}>
      {icon}
      {children != null && children !== false && <span className="ui-btn__label">{children}</span>}
    </button>
  );
}
