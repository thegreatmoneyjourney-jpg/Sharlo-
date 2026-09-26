export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-6 text-center dark:bg-black">
      <main className="flex max-w-xl flex-col items-center gap-4">
        <h1 className="text-4xl font-semibold tracking-tight text-black dark:text-zinc-50">
          Sharlo
        </h1>
        <p className="text-lg leading-8 text-zinc-600 dark:text-zinc-400">
          Grade multiple-choice bubble sheets by camera in seconds. No scanner, no per-scan cost,
          and your students&rsquo; data never leaves your control.
        </p>
        <a
          href="/signin"
          className="rounded-md bg-emerald-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-emerald-700"
        >
          Get started
        </a>
        <p className="text-sm text-zinc-400 dark:text-zinc-600">
          Marketing site and app under construction — see{' '}
          <code className="rounded bg-black/[.06] px-1.5 py-0.5 font-mono text-[0.9em] dark:bg-white/[.08]">
            docs/TASKS.md
          </code>{' '}
          for build progress.
        </p>
      </main>
    </div>
  );
}
