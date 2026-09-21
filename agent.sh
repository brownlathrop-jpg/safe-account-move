#!/bin/bash
# agent.sh — посредник для выполнения команд ИИ
# Использование: ./agent.sh
# Ввод: вставьте команду(и), завершите пустой строкой или словом END

set -u

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

LOG_FILE=".agent-history.log"

echo -e "${CYAN}╔══════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║     Агент-посредник для КабинетCRM       ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════╝${NC}"
echo ""

# Проверяем, что мы в нужном репозитории
if ! git rev-parse --git-dir >/dev/null 2>&1; then
    echo -e "${RED}✗ Это не git-репозиторий. Запустите скрипт в папке проекта.${NC}"
    exit 1
fi

REPO=$(basename "$(git rev-parse --show-toplevel)")
echo -e "${GREEN}✓ Репозиторий:${NC} $REPO"
echo -e "${GREEN}✓ Ветка:${NC} $(git branch --show-current)"
echo -e "${GREEN}✓ История команд будет в:${NC} $LOG_FILE"
echo ""
echo -e "${YELLOW}Правила ввода:${NC}"
echo "  • Вставьте команду (можно несколько строк)"
echo "  • Завершите ввод пустой строкой или словом END"
echo "  • Команды 'статус', 'выход', 'отмена' — служебные"
echo ""

while true; do
    echo -e "${BLUE}────────────────────────────────────────────${NC}"
    echo -e "${BLUE}Введите команду (или 'выход'):${NC}"
    
    CMD=""
    while IFS= read -r line; do
        # Завершение ввода
        if [ -z "$line" ] || [ "$line" = "END" ] || [ "$line" = "end" ]; then
            break
        fi
        
        # Служебные команды
        case "$line" in
            "выход"|"exit"|"quit")
                echo -e "${GREEN}До встречи!${NC}"
                exit 0
                ;;
            "статус"|"status")
                git status --short
                echo ""
                continue 2
                ;;
        esac
        
        CMD="$CMD$line"$'\n'
    done
    
    # Пустой ввод — продолжаем
    if [ -z "$CMD" ]; then
        continue
    fi
    
    echo ""
    echo -e "${YELLOW}Будет выполнено:${NC}"
    echo -e "${CYAN}$CMD${NC}"
    echo ""
    
    read -p "Выполнить? [д]а / [н]ет / [п]о одной команде: " CONFIRM
    
    case "$CONFIRM" in
        "н"|"нет"|"no"|"n")
            echo -e "${YELLOW}Отменено.${NC}"
            echo ""
            continue
            ;;
        "п"|"по"|"по одной"|"p")
            # Выполняем по одной команде
            echo ""
            while IFS= read -r single_cmd; do
                [ -z "$single_cmd" ] && continue
                echo -e "${BLUE}> $single_cmd${NC}"
                read -p "  Выполнить эту команду? [д/н]: " SINGLE_CONFIRM
                if [ "$SINGLE_CONFIRM" = "д" ] || [ "$SINGLE_CONFIRM" = "да" ]; then
                    eval "$single_cmd"
                    echo "$(date '+%Y-%m-%d %H:%M:%S') | $single_cmd" >> "$LOG_FILE"
                else
                    echo -e "${YELLOW}  Пропущено${NC}"
                fi
                echo ""
            done <<< "$CMD"
            ;;
        *)
            # Выполняем весь блок
            echo ""
            echo -e "${GREEN}Выполняю...${NC}"
            echo "$(date '+%Y-%m-%d %H:%M:%S') | ЗАПУСК БЛОКА:" >> "$LOG_FILE"
            echo "$CMD" >> "$LOG_FILE"
            
            eval "$CMD"
            EXIT_CODE=$?
            
            echo ""
            if [ $EXIT_CODE -eq 0 ]; then
                echo -e "${GREEN}✓ Завершено успешно${NC}"
            else
                echo -e "${RED}✗ Завершено с ошибкой (код $EXIT_CODE)${NC}"
            fi
            echo "Код выхода: $EXIT_CODE" >> "$LOG_FILE"
            ;;
    esac
    
    echo ""
done