import Image from "next/image";

interface AppLogoProps {
  size?: number;
  className?: string;
}

export function AppLogo({ size = 28, className }: AppLogoProps) {
  return (
    <>
      <Image
        src="/logo-dark.svg"
        alt=""
        width={size}
        height={size}
        className={`hidden dark:block${className ? ` ${className}` : ""}`}
        aria-hidden="true"
      />
      <Image
        src="/logo-light.svg"
        alt=""
        width={size}
        height={size}
        className={`block dark:hidden${className ? ` ${className}` : ""}`}
        aria-hidden="true"
      />
    </>
  );
}
