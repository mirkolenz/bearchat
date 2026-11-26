import logo from "@/favicon.svg";

/** The app logo, decorative since it accompanies the title wherever it appears. */
export function Logo({ className }: { className?: string }) {
  return <img src={logo} alt="" className={className} />;
}
