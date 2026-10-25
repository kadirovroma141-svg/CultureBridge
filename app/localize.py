"""Polite rephrasings in English and in the listener's own language (offline phrasebook).

The LLM returns these variants when it is reachable; this module guarantees that the Subtext Translator
still answers with *two English variants + one local-language variant* when the server is offline and the
answer comes from the expert cache or the rule engine.
"""

CATEGORIES = ("criticism", "food", "time", "request", "ask", "decline", "neutral")

LANGUAGE_NAMES = {
    "kk-KZ": "Kazakh · Қазақша", "it-IT": "Italian · Italiano", "hu-HU": "Hungarian · Magyar",
    "zh-CN": "Chinese · 中文", "ja-JP": "Japanese · 日本語", "ko-KR": "Korean · 한국어", "de-DE": "German · Deutsch",
    "en-GB": "British English", "en-US": "American English", "en-CA": "Canadian English",
}

# (formal, friendly) English variants; the one that differs from the engine's main answer is shown as the second option
ALT_EN = {
    "criticism": ("Thank you for sharing this. I have some reservations — might we review an alternative together?",
                  "I like where you are going! Could we also try another angle together?"),
    "food": ("Thank you very much for your hospitality — everything looks wonderful. I would be delighted to have a small portion.",
             "This smells amazing, thank you! Just a little bit for me, please."),
    "time": ("May I suggest we confirm a fixed time in advance? It would help everyone plan, and I would be grateful.",
             "Could we agree on a start time next time? It would make planning way easier for all of us."),
    "request": ("Dear Professor, if your schedule permits, I would be most grateful if you could review my essay by tomorrow.",
                "Hello Professor! Whenever you have a moment, could you take a look at my essay? It is due tomorrow."),
    "ask": ("Excuse me, would you be so kind as to share your notes from yesterday's lecture?",
            "Hey, could you share yesterday's notes when you get a chance? Thanks a lot!"),
    "decline": ("Thank you for the kind invitation. Regrettably I am unable to attend, but I hope there will be another occasion.",
                "Thank you for inviting me! I can't make it this time, but I would love to join next time."),
    "neutral": ("Thank you for your understanding; I appreciate your consideration.",
                "Thanks for understanding — I really appreciate it!"),
}

PHRASEBOOK = {
    "kk-KZ": {
        "criticism": "Идеяңыз қызық екен, бірақ бірге тағы бір шешімді қарастырып көрсек қайтеді?",
        "food": "Рақмет, өте дәмді көрінеді! Аздап қана татып көрсем бола ма?",
        "time": "Кешіріңіз, келесі жолы уақытты алдын ала келісіп алсақ, бәріміз үшін ыңғайлы болар еді.",
        "request": "Құрметті профессор, егер мүмкіндік болса, эссемді ертеңге дейін қарап шыға аласыз ба? Алдын ала рақмет.",
        "ask": "Кешіріңіз, егер қиын болмаса, кешегі дәрістің жазбаларын бөлісе аласыз ба? Рақмет!",
        "decline": "Шақырғаныңызға көп рақмет! Өкінішке қарай, келе алмаймын, бірақ келесі жолы міндетті түрде қосыламын.",
        "neutral": "Түсіністікпен қарағаныңызға рақмет.",
    },
    "it-IT": {
        "criticism": "L'idea è interessante, ma potremmo valutare insieme anche un'altra soluzione?",
        "food": "Grazie, ha un aspetto buonissimo! Posso assaggiarne solo un po'?",
        "time": "Scusa se te lo dico, ma potremmo metterci d'accordo sugli orari così da organizzarci tutti meglio?",
        "request": "Gentile professore, se i suoi impegni lo permettono, potrebbe dare un'occhiata al mio saggio entro domani? La ringrazio molto.",
        "ask": "Ciao! Quando hai un attimo, potresti condividere gli appunti di ieri con me? Grazie mille!",
        "decline": "Grazie mille per l'invito! Purtroppo non riesco a venire, ma mi piacerebbe unirmi la prossima volta.",
        "neutral": "Grazie per la comprensione.",
    },
    "hu-HU": {
        "criticism": "Érdekes az ötlet, de talán közösen megnézhetnénk egy másik megoldást is?",
        "food": "Köszönöm, nagyon finomnak tűnik! Megkóstolhatok belőle egy kicsit?",
        "time": "Elnézést, hogy szóba hozom, de megbeszélhetnénk egy pontos időpontot, hogy mindenki tudjon tervezni?",
        "request": "Tisztelt Professzor! Ha az idejéből futja, megnézné kérem a dolgozatomat holnapig? Nagyon köszönöm.",
        "ask": "Szia! Ha van egy perced, megosztanád velem a tegnapi jegyzeteket? Köszönöm szépen!",
        "decline": "Nagyon köszönöm a meghívást! Sajnos nem tudok jönni, de legközelebb szívesen csatlakozom.",
        "neutral": "Köszönöm a megértést.",
    },
    "zh-CN": {
        "criticism": "这个想法很有意思，不过我们能不能一起再看看其他方案？",
        "food": "谢谢，看起来太好吃了！我可以先尝一小口吗？",
        "time": "不好意思提一下，我们能不能提前约好时间，这样大家都方便安排？",
        "request": "尊敬的老师，如果您方便的话，能否在明天之前帮我看一下论文？非常感谢您。",
        "ask": "你好！方便的时候，能把昨天的课堂笔记分享给我吗？谢谢你！",
        "decline": "非常感谢您的邀请！很遗憾我这次去不了，下次一定参加。",
        "neutral": "感谢您的理解。",
    },
    "ja-JP": {
        "criticism": "とても興味深いアイデアですね。ほかの方法も一緒に検討してみませんか？",
        "food": "ありがとうございます、とても美味しそうです。少しだけいただいてもよろしいですか？",
        "time": "お話しして恐縮ですが、時間を事前に決めておくと皆さん動きやすいかもしれません。",
        "request": "先生、お忙しいところ恐れ入りますが、明日までに私のエッセイをご確認いただけませんでしょうか。よろしくお願いいたします。",
        "ask": "お手数ですが、昨日の講義のノートを見せていただけませんか？ありがとうございます。",
        "decline": "お誘いいただきありがとうございます。あいにく伺えませんが、またの機会にぜひご一緒させてください。",
        "neutral": "ご理解いただきありがとうございます。",
    },
    "ko-KR": {
        "criticism": "정말 흥미로운 아이디어네요. 다른 방법도 함께 검토해 보면 어떨까요?",
        "food": "감사합니다, 정말 맛있어 보여요! 조금만 맛봐도 될까요?",
        "time": "말씀드리기 조심스럽지만, 시간을 미리 정해 두면 모두가 준비하기 편할 것 같아요.",
        "request": "교수님, 바쁘신 중에 죄송합니다만, 내일까지 제 에세이를 한번 봐주실 수 있을까요? 감사합니다.",
        "ask": "혹시 괜찮으시다면 어제 강의 노트를 공유해 주실 수 있을까요? 감사합니다!",
        "decline": "초대해 주셔서 정말 감사합니다. 아쉽지만 이번에는 참석하기 어렵습니다. 다음에 꼭 함께하고 싶어요.",
        "neutral": "이해해 주셔서 감사합니다.",
    },
    "de-DE": {
        "criticism": "Ich habe Bedenken bei der Idee – können wir gemeinsam eine alternative Lösung prüfen?",
        "food": "Danke, das sieht sehr gut aus. Ich nehme gern nur eine kleine Portion.",
        "time": "Bitte lass uns eine feste Uhrzeit vereinbaren und einhalten, damit alle gut planen können.",
        "request": "Sehr geehrter Herr Professor, könnten Sie meinen Essay bitte bis morgen durchsehen? Vielen Dank im Voraus.",
        "ask": "Könntest du mir bitte die Mitschrift der gestrigen Vorlesung schicken? Danke!",
        "decline": "Vielen Dank für die Einladung. Leider kann ich nicht kommen – ich sage es lieber gleich ehrlich.",
        "neutral": "Danke für dein Verständnis.",
    },
    "en-GB": {
        "criticism": "That's an interesting idea — I wonder if we might also look at another approach?",
        "food": "That looks lovely, thank you — I'll just have a small helping, if that's alright.",
        "time": "Sorry to mention it, but could we perhaps pin down a time so everyone can plan?",
        "request": "Dear Professor, I was wondering whether you might have a moment to look at my essay before tomorrow? Many thanks.",
        "ask": "Sorry to bother you — would you mind sharing the notes from yesterday's lecture? Cheers!",
        "decline": "Thanks ever so much for the invite — I'm afraid I can't make it, but do ask me again.",
        "neutral": "Thanks for understanding.",
    },
    "en-US": {
        "criticism": "I love the energy here! I'm just wondering — could we also explore another option together?",
        "food": "This looks amazing, thank you! I'll just take a small bit.",
        "time": "Hey, quick thing — can we lock in a start time so everybody can plan? Thanks!",
        "request": "Hi Professor, would it be possible for you to look at my essay by tomorrow? I'd really appreciate it.",
        "ask": "Hey! Would you mind sending me yesterday's lecture notes? That'd be super helpful, thanks!",
        "decline": "Thanks so much for inviting me! I can't make it this time, but let's definitely do something soon.",
        "neutral": "Thanks for understanding!",
    },
    "en-CA": {
        "criticism": "That's a really good start — sorry, could we maybe also look at one more option together?",
        "food": "This looks great, thanks so much! I'll just have a little, if that's okay.",
        "time": "Sorry to bring it up — could we pick a time ahead so everyone can plan? Thanks so much.",
        "request": "Hello Professor, sorry to bother you — would you be able to look at my essay by tomorrow? Thank you so much.",
        "ask": "Hi! Sorry to ask, but could you share yesterday's lecture notes with me? Thanks a lot!",
        "decline": "Thank you so much for inviting me! Sorry, I can't make it this time, but I'd love to join the next one.",
        "neutral": "Thanks for understanding, I really appreciate it.",
    },
}


def variants(category: str, lang: str, adapted: str, hierarchy: int) -> dict:
    """Two English variants (the engine's answer + an alternative register) and a local-language variant."""
    cat = category if category in CATEGORIES else "neutral"
    formal, friendly = ALT_EN[cat]
    alt = friendly if hierarchy >= 65 else formal      # offer the *other* register than the one the culture implies
    if alt.strip().lower() == adapted.strip().lower():
        alt = formal if alt == friendly else friendly
    book = PHRASEBOOK.get(lang) or PHRASEBOOK["en-GB"]
    return {
        "en": [adapted, alt],
        "local": {"language": LANGUAGE_NAMES.get(lang, lang), "lang": lang, "text": book[cat]},
    }
