pipeline {
    agent { label 'docker' }

    options {
        disableConcurrentBuilds()
        timestamps()
        timeout(time: 45, unit: 'MINUTES')
        skipDefaultCheckout(true)
    }

    parameters {
        string(
            name: 'ONCHAIN_INTEGRATION_COMMAND',
            defaultValue: 'cargo test --locked',
            description: 'Contract integration command. Keep live-network credentials in Jenkins credentials.'
        )
    }

    environment {
        COMPOSE_PROJECT_NAME = "rwa-jenkins-${env.BUILD_NUMBER}"
        CI = 'true'
        NODE_ENV = 'test'
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Toolchain') {
            steps {
                sh '''
                    set -eu
                    node --version
                    npm --version
                    docker --version
                    docker compose version
                    cargo --version
                    rustc --version
                '''
            }
        }

        stage('Install dependencies') {
            parallel {
                stage('Backend') {
                    steps {
                        dir('backend') {
                            sh 'npm ci'
                        }
                    }
                }
                stage('Frontend') {
                    steps {
                        dir('frontend') {
                            sh 'npm ci'
                        }
                    }
                }
                stage('SDK') {
                    steps {
                        dir('sdk') {
                            sh 'npm ci'
                        }
                    }
                }
                stage('Contracts') {
                    steps {
                        dir('contracts') {
                            sh 'rustup target add wasm32-unknown-unknown && cargo fetch --locked'
                        }
                    }
                }
            }
        }

        stage('Typecheck SDK') {
            steps {
                sh 'npm run typecheck:sdk'
            }
        }

        stage('On-chain contract tests') {
            steps {
                dir('contracts') {
                    sh '${ONCHAIN_INTEGRATION_COMMAND}'
                }
            }
        }

        stage('Contract resource benchmarks') {
            steps {
                sh 'MAX_CPU_INSTRUCTIONS=${MAX_CPU_INSTRUCTIONS:-0} scripts/benchmark-contracts.sh'
            }
        }

        stage('Off-chain service tests') {
            steps {
                dir('backend') {
                    sh 'npm test -- --runInBand'
                }
            }
        }

        stage('Service and contract integration') {
            steps {
                sh '''
                    set -eu
                    docker compose --profile dev up -d --build postgres redis backend
                    trap 'docker compose --profile dev down -v --remove-orphans' EXIT

                    for attempt in $(seq 1 30); do
                        if curl --fail --silent http://localhost:3001/health >/dev/null; then
                            break
                        fi
                        if [ "$attempt" -eq 30 ]; then
                            docker compose logs backend postgres redis
                            exit 1
                        fi
                        sleep 2
                    done

                    curl --fail --silent http://localhost:3001/health | tee backend-health.json
                    curl --fail --silent 'http://localhost:3001/api/v1/rwa?limit=1' | tee rwa-api-response.json
                    test -s rwa-api-response.json
                '''
            }
        }
    }

    post {
        always {
            sh 'docker compose --profile dev down -v --remove-orphans || true'
            archiveArtifacts artifacts: '*-health.json,*-api-response.json,contract-benchmark-report.txt', allowEmptyArchive: true
            junit allowEmptyResults: true, testResults: '**/test-results/*.xml,**/junit*.xml'
        }
    }
}