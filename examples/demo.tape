Output examples/wizard-demo.gif

Set FontSize 13
Set Width 960
Set Height 700
Set TypingSpeed 80ms
Set Padding 16

Type "nub examples/deploy.ts deploy --wizard"
Enter
Wait+Screen@5s /--service <name>/
Sleep 600ms
Type "api"
Enter
Wait+Screen@5s /AWS region/
Sleep 600ms
Enter
Wait+Screen@5s /skip safety checks/
Sleep 600ms
Enter
Wait+Screen@5s /target environment/
Sleep 400ms
Down
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
Wait+Screen@5s /environment:/
Sleep 3s
