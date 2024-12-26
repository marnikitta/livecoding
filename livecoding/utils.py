import random

vowels = "aeiou"
consonants = "bcdfghjklmnpqrstvwxyz"


def generate_phonetic_name(length: int = 14) -> str:
    text = ""
    start = random.random() < 0.5

    for i in range(length):
        if i % 2 == start:
            text += random.choice(consonants)
        else:
            text += random.choice(vowels)

    return text


if __name__ == '__main__':
    print(generate_phonetic_name(14))
