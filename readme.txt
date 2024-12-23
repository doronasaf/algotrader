Git Troubleshooting Guide

1. Check Your SSH Key
Ensure your SSH key is still available on your machine:
    ls ~/.ssh
Look for files like id_rsa and id_rsa.pub (or other key names you've set up).

Confirm your SSH key matches the one registered with GitHub:
    cat ~/.ssh/id_rsa.pub
Compare the output with the SSH key listed in your GitHub account settings.

2. Test SSH Connection
Test if your SSH key works with GitHub:
    ssh -T git@github.com
If the connection fails, it might provide more details about the issue.

3. Ensure the SSH Agent is Running
Start the SSH agent and add your SSH key:
    eval "$(ssh-agent -s)"
    ssh-add ~/.ssh/algotrader_key

4. Verify SSH Key Configuration in Git
Check if Git is configured to use the correct SSH key:
    git config --global core.sshCommand
If this command outputs anything, ensure it's pointing to the correct key. If not, you can set it:
    git config --global core.sshCommand "ssh -i ~/.ssh/algotrader_key -F /dev/null"

5. Check GitHub Settings
    Go to GitHub > Settings > SSH and GPG keys.
Ensure your public key is correctly added to your GitHub account.

6. Update Remote URL
Make sure the remote URL is set to use SSH:
    git remote -v
If the URL starts with https://, it means you're using HTTPS instead of SSH. To fix this:
    git remote set-url origin git@github.com:username/repository.git


Node Troubleshooting Guide

When getting warning message from Node, run:
    node --no-deprecation yourScript.js

installing newer version of problematic lib:
    npm outdated
    npm update
    npm install whatwg-url@latest

Check Dependent Libraries:
    npm ls whatwg-url

