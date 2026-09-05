#!/usr/bin/expect -f
# Real terminal check for non-numeric inline validation: date, enum, URL.
set timeout 20
spawn nub tests/smoke-validate-cli.ts schedule --wizard
exec stty rows 40 columns 140 < $spawn_out(slave,name)
expect_before {
  timeout { puts stderr "SMOKE-FAIL: timed out"; exit 1 }
  eof { puts stderr "SMOKE-FAIL: child exited early"; exit 1 }
}
# start: required, no default — garbage first, then a real date
expect -exact "window start" { send "banana\r" }
expect -exact "must be a valid date" { send "\0252026-06-01\r" }
# mode: irreversible default — leave "Keep default", pick "Enter a value", try an invalid one
expect -exact "default: 'eco'" { send "\033\[B\r" }
expect -exact "travel mode" { send "warp9\r" }
expect -exact "mode must be eco or warp" { send "\025warp\r" }
# url: optional — relative URL first, then absolute
expect -exact "status endpoint" { send "example.com/x\r" }
expect -exact "must be an absolute URL" { send "\025https://status.example.com/x\r" }
expect -exact "rerun non-interactively:"
expect -exact "Continue or edit an input?" { send "\r" }
expect -exact "Run with these settings?" { send "y\r" }
expect -re {scheduled: (\{[^\r\n]+\})} {
  set payload $expect_out(1,string)
  exec node -e {
    const assert = require('node:assert/strict');
    assert.deepEqual(JSON.parse(process.argv[1]), {
      start: '2026-06-01T00:00:00.000Z', mode: 'warp', url: 'https://status.example.com/x'
    });
  } $payload
}
expect_before
expect eof
set result [wait]
if {[lindex $result 2] != 0 || [lindex $result 3] != 0} {
  puts stderr "SMOKE-FAIL: $result"; exit 1
}
puts "SMOKE-OK"
