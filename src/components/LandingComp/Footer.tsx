import React from "react";
import Link from "next/link";
import Chords from "./Chords";
const Footer = () => {
  return (
    <footer className="flex flex-col gap-2 sm:flex-row py-6 w-full shrink-0 items-center px-2  md:px-4 border-t">
    <p className="text-sm text-muted-foreground"> 
      <Chords /> | &copy; {new Date().getFullYear()}{" "}
      <Link href="https://upsidedownlabs.tech/" target="_blank">
        Upside Down Labs
      </Link>
    </p>
    <nav className="sm:ml-auto flex gap-4 sm:gap-6">
      <Link
        className="text-sm hover:underline underline-offset-4"
        target="_blank"
        href="https://docs.upsidedownlabs.tech/guides/index.html"
      >
        Guides
      </Link>
      <Link
        className="text-sm hover:underline underline-offset-4"
        href="https://linktr.ee/Upside_Down_Labs_Stores"
        target="_blank"
      >
        Stores
      </Link>
    </nav>
  </footer>

  );
};

export default Footer;
