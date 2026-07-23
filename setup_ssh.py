import paramiko
import sys
import time

host = '104.248.221.102'
user = 'root'
password = 'Sdkl346GD!ds'
stripe_key = 'mk_1Tsx4Q18OJBs5K1fSkddayVE'

def run_ssh():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        print(f"Connecting to {host}...")
        client.connect(hostname=host, username=user, password=password, timeout=10)
        print("Connected successfully.")
        
        # 1. Update the service file
        service_path = '/etc/systemd/system/profesudg.service'
        print(f"Reading {service_path}...")
        stdin, stdout, stderr = client.exec_command(f'cat {service_path}')
        service_content = stdout.read().decode('utf-8')
        
        if not service_content:
            print("Error: Could not read service file or it is empty.")
            return

        lines = service_content.split('\n')
        new_lines = []
        key_exists = False
        in_service_block = False
        
        for line in lines:
            if line.strip() == '[Service]':
                in_service_block = True
                new_lines.append(line)
            elif in_service_block and line.strip().startswith('Environment="STRIPE_SECRET_KEY='):
                new_lines.append(f'Environment="STRIPE_SECRET_KEY={stripe_key}"')
                key_exists = True
            elif in_service_block and line.strip().startswith('['):
                # Moving out of [Service] block, insert key if we haven't
                if not key_exists:
                    new_lines.append(f'Environment="STRIPE_SECRET_KEY={stripe_key}"')
                    key_exists = True
                in_service_block = False
                new_lines.append(line)
            else:
                new_lines.append(line)
                
        # If EOF reached and we were still in Service block and hadn't inserted
        if in_service_block and not key_exists:
            new_lines.append(f'Environment="STRIPE_SECRET_KEY={stripe_key}"')
            
        new_content = '\n'.join(new_lines)
        
        print("Updating service file...")
        # Write new content to a temp file then move it
        sftp = client.open_sftp()
        with sftp.file('/tmp/profesudg.service', 'w') as f:
            f.write(new_content)
        sftp.close()
        
        client.exec_command('mv /tmp/profesudg.service /etc/systemd/system/profesudg.service')
        
        # 2. Pull latest code and restart
        commands = [
            'cd /var/www/ProfesUdG && git pull',
            'systemctl daemon-reload',
            'systemctl restart profesudg',
            'systemctl status profesudg --no-pager | head -n 15'
        ]
        
        for cmd in commands:
            print(f"Executing: {cmd}")
            stdin, stdout, stderr = client.exec_command(cmd)
            out = stdout.read().decode('utf-8')
            err = stderr.read().decode('utf-8')
            if out: print(out)
            if err: print("STDERR:", err)
            
    except Exception as e:
        print(f"Error: {e}")
    finally:
        client.close()

if __name__ == '__main__':
    run_ssh()
