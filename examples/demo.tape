Output examples/demo.gif

Set FontSize 12
Set Width 960
Set Height 1000
Set TypingSpeed 80ms
Set Padding 16

Type "nub examples/deploy.ts deploy --wizard"
Enter
Wait+Screen@5s /service to deploy/
Sleep 600ms
Type "api"
Enter
Wait+Screen@5s /git tag/
Sleep 600ms
Type "v1.4.2"
Enter
Wait+Screen@5s /AWS regions/
Sleep 400ms
Down
Sleep 400ms
Space
Sleep 700ms
Enter
Wait+Screen@5s /skip safety checks/
Sleep 600ms
Enter
Wait+Screen@5s /instance count/
Sleep 600ms
Enter
Wait+Screen@5s /deploy tags/
Sleep 600ms
Type "canary"
Enter
Sleep 700ms
Enter
Wait+Screen@5s /verbosity/
Sleep 600ms
Enter
Wait+Screen@5s /target environments/
Sleep 400ms
Space
Sleep 400ms
Down
Sleep 400ms
Space
Sleep 700ms
Enter

# Review the inputs and the rerun command.
Wait+Screen@5s /Continue or edit/
Sleep 2s
Enter
Wait+Screen@5s /Run with these settings/
Sleep 500ms
Type "y"
Enter
Wait+Screen@5s /deploying/
Sleep 3s
