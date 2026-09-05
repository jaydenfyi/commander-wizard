#!/usr/bin/expect -f
# Real terminal integration check, in addition to the deterministic unit tests.
set timeout 20
spawn nub tests/smoke-cli.ts deploy --wizard --force --replicas 7
exec stty rows 40 columns 140 < $spawn_out(slave,name)
expect_before {
  timeout { puts stderr "SMOKE-FAIL: timed out"; exit 1 }
  eof { puts stderr "SMOKE-FAIL: child exited early"; exit 1 }
}
# options first, then arguments (envs multiselect comes last)
expect -exact "service to deploy" { send "my-svc\r" }
expect -exact "git tag to deploy" { send "v2.0\r" }
# regions: multiselect, default us-east-1 preselected — down+space adds eu-west-1
expect -exact "AWS regions" { send "\033\[B \r" }
expect -exact "deploy tags (empty line to finish)" { send "a\r" }
expect -exact "added: a (empty line to finish)" { send "b\r" }
expect -exact "added: a, b (empty line to finish)" { send "\r" }
expect -exact "verbosity" { send "\r" }
# envs: required multiselect — space toggles dev, down+space adds staging
expect -exact "target environments" { send " " }
expect -exact "staging" { send "\033\[B " }
expect -exact "staging" { send "\r" }
expect -exact "rerun non-interactively:"
# Edit the service from review; Ctrl-U clears its prefilled answer.
expect -exact "Continue or edit an input?" { send "\033\[B\r" }
expect -exact "service to deploy" { send "\025edited-svc\r" }
expect -exact "Continue or edit an input?" { send "\r" }
expect -exact "Run with these settings?" { send "y\r" }
expect -re {deploying: (\{[^\r\n]+\})} {
  set payload $expect_out(1,string)
  exec node -e {
    const assert = require('node:assert/strict');
    assert.deepEqual(JSON.parse(process.argv[1]), {
      envs: ['dev', 'staging'], tag: 'v2.0', regions: ['us-east-1', 'eu-west-1'], replicas: 7,
      logLevel: 'info', force: true, service: 'edited-svc', tags: ['a', 'b']
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
