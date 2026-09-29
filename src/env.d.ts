/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    /** Username login aplikasi (SECURITY_ENABLELOGIN=true). */
    appUser?: string;
  }
}
