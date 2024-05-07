#!/usr/bin/python3

import json

class Item:
    def __init__(self):
        self._name = ''
        self._description = ''

    def set_name(self, name):
        self._name = name

    def set_description(self, description):
        self._description = description.replace('"', '\\"')

    def to_object(self):
        return '{\n'+ f'\t"name": "{self._name}",\n\t"description": "{self._description}"\n' + '}'

def get_json_filename(fname):
    return fname.replace('.input', '') + '.json'

def read_files(input_fname, output_fname):
    input = open(input_fname, 'r')
    # print(output_fname)
    output = open(output_fname, 'w')
    lines = input.readlines()
    items, lines = [], [ line.strip() for line in lines if line.strip() != '' ]
    for i in range(0, len(lines), 2 ):
        name, desc = lines[i], lines[i+1]
        item = Item()
        item.set_name(name)
        item.set_description(desc)
        items.append(item)
    # output.write('[')
    print('[', file=output)
    for idx,item in enumerate(items):
        end_char = ',\n'
        if idx == len(items)-1:
            end_char = '\n'
        print(item.to_object(), end=end_char, file=output)
        # output.write(item.to_object(), end=end_char)    
    print(']', file=output)
    # output.write(']')

inputs = open('./inputs', 'r').readlines()
input_files = [ line.strip() for line in inputs if line.strip() != '' ]
for line in input_files:
    input_name, output_name = line, get_json_filename(line)
    read_files(input_name, output_name)
