$p = 'K:\yt_extension\yt_transcriber\src\ui\views\AiView.tsx'
$t = [IO.File]::ReadAllText($p)

$old1 = @"
        setNeedsConsent(true);
        (runPipeline as unknown as { pending?: () => Promise<void> }).pending = () =>
          runPipeline(pipeline, true);
"@
$new1 = @"
        setNeedsConsent(true);
        pendingPipeline.current = pipeline;
"@

$old2 = @"
        setStatus({
          tone: 'error',
          text: `` ``,
        });
"@
$new2 = @"
        setStatus({
          tone: 'error',
          text: String(s.tr('ai.error.network')) + ' ' + (r.errorMessage ?? r.errorCode ?? ''),
        });
"@

$old3 = @"
    const pending = (runPipeline as unknown as { pending?: () => Promise<void> }).pending;
    if (pending) await pending();
"@
$new3 = @"
    const pending = pendingPipeline.current;
    pendingPipeline.current = null;
    if (pending) await runPipeline(pending, true);
"@

# Normalize CRLF for matching
$pairs = @(@($old1, $new1), @($old2, $new2), @($old3, $new3))
foreach ($pair in $pairs) {
  $o = $pair[0] -replace "`n", "`r`n"
  $n = $pair[1] -replace "`n", "`r`n"
  if ($t.Contains($o)) {
    $t = $t.Replace($o, $n)
  } elseif ($t.Contains($pair[0])) {
    $t = $t.Replace($pair[0], $pair[1])
  } else {
    Write-Output "MISS: $($pair[0].Substring(0, 40))"
  }
}
[IO.File]::WriteAllText($p, $t)
Write-Output "done"
