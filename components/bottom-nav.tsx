"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  Users,
  BarChart2,
  MoreHorizontal,
  Smartphone,
  Download,
  Info,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useMyIdentity } from "@/lib/hooks/use-my-identity";
import { useWhatsNew } from "@/components/whats-new-provider";
import { TrackedShootersSheet } from "@/components/tracked-shooters-sheet";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { RELEASES } from "@/lib/releases";

function NavItem({
  href,
  icon,
  label,
  active,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex flex-col items-center justify-center gap-0.5 min-w-[64px] min-h-[44px] text-xs transition-colors",
        active
          ? "text-primary"
          : "text-muted-foreground hover:text-foreground"
      )}
      aria-current={active ? "page" : undefined}
    >
      <span className="[&>svg]:h-5 [&>svg]:w-5" aria-hidden="true">
        {icon}
      </span>
      <span>{label}</span>
    </Link>
  );
}

function NavButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center justify-center gap-0.5 min-w-[64px] min-h-[44px] text-xs text-muted-foreground hover:text-foreground transition-colors"
    >
      <span className="[&>svg]:h-5 [&>svg]:w-5" aria-hidden="true">
        {icon}
      </span>
      <span>{label}</span>
    </button>
  );
}

function MoreLink({
  href,
  icon,
  label,
  onClose,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  onClose: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClose}
      className="flex items-center gap-3 px-1 py-2 min-h-[44px] text-sm text-foreground hover:text-primary transition-colors"
    >
      <span
        className="[&>svg]:h-5 [&>svg]:w-5 text-muted-foreground"
        aria-hidden="true"
      >
        {icon}
      </span>
      {label}
    </Link>
  );
}

function MoreButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 px-1 py-2 min-h-[44px] w-full text-sm text-foreground hover:text-primary transition-colors"
    >
      <span
        className="[&>svg]:h-5 [&>svg]:w-5 text-muted-foreground"
        aria-hidden="true"
      >
        {icon}
      </span>
      {label}
    </button>
  );
}

function MoreSheet({
  open,
  onOpenChange,
  onWhatsNew,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onWhatsNew: () => void;
}) {
  const hasReleases = RELEASES.length > 0;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>More</DrawerTitle>
          <DrawerDescription className="sr-only">
            App settings and information
          </DrawerDescription>
        </DrawerHeader>
        <div className="px-4 pb-4 divide-y divide-border">
          <div className="pb-2">
            <MoreLink
              href="/sync"
              icon={<Smartphone />}
              label="Sync devices"
              onClose={() => onOpenChange(false)}
            />
            <MoreLink
              href="/about#install"
              icon={<Download />}
              label="Install app"
              onClose={() => onOpenChange(false)}
            />
            <MoreLink
              href="/about"
              icon={<Info />}
              label="About"
              onClose={() => onOpenChange(false)}
            />
            {hasReleases && (
              <MoreButton
                icon={<Sparkles />}
                label="What's new"
                onClick={onWhatsNew}
              />
            )}
          </div>
          <div className="pt-3 flex items-center gap-3 px-1">
            <span className="text-sm text-muted-foreground">Theme</span>
            <ThemeToggle />
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

export function BottomNav() {
  const pathname = usePathname();
  const { identity } = useMyIdentity();
  const { setOpen: setWhatsNewOpen } = useWhatsNew();
  const [showShooters, setShowShooters] = useState(false);
  const [showMore, setShowMore] = useState(false);

  function handleWhatsNew() {
    setShowMore(false);
    setWhatsNewOpen(true);
  }

  const myStatsHref = identity ? `/shooter/${identity.shooterId}` : null;
  const isMyStatsActive = myStatsHref
    ? pathname.startsWith(`/shooter/${identity!.shooterId}`)
    : false;

  return (
    <>
      <nav
        aria-label="Main navigation"
        className="fixed bottom-0 inset-x-0 z-40 md:hidden border-t border-border bg-background/80 backdrop-blur-lg"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="flex items-center justify-around h-14">
          <NavItem
            href="/"
            icon={<Home />}
            label="Home"
            active={pathname === "/"}
          />
          <NavButton
            icon={<Users />}
            label="Shooters"
            onClick={() => setShowShooters(true)}
          />
          {myStatsHref ? (
            <NavItem
              href={myStatsHref}
              icon={<BarChart2 />}
              label="My Stats"
              active={isMyStatsActive}
            />
          ) : (
            <NavButton
              icon={<BarChart2 />}
              label="My Stats"
              onClick={() => setShowShooters(true)}
            />
          )}
          <NavButton
            icon={<MoreHorizontal />}
            label="More"
            onClick={() => setShowMore(true)}
          />
        </div>
      </nav>

      <TrackedShootersSheet open={showShooters} onOpenChange={setShowShooters} />
      <MoreSheet
        open={showMore}
        onOpenChange={setShowMore}
        onWhatsNew={handleWhatsNew}
      />
    </>
  );
}
