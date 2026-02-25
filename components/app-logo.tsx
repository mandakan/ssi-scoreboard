interface AppLogoProps {
  size?: number;
  className?: string;
}

export function AppLogo({ size = 28, className }: AppLogoProps) {
  const base = `block${className ? ` ${className}` : ""}`;
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo-dark.svg"
        alt=""
        width={size}
        height={size}
        className={`hidden dark:block ${base}`}
        aria-hidden="true"
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo-light.svg"
        alt=""
        width={size}
        height={size}
        className={`dark:hidden ${base}`}
        aria-hidden="true"
      />
    </>
  );
}
